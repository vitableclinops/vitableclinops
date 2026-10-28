import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CompanyMeetingWizard } from '@/components/meetings/CompanyMeetingWizard';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { cn, parseLocalDate } from '@/lib/utils';
import { meetingStateGroups, selectedMeetingStates } from '@/lib/collabMeetingStates';
import {
  COLLAB_SPREADSHEET_LIBRARY_KEY, libraryUrlsForStates, meetingMonthName, mergeLibraryDefaults,
} from '@/lib/collabSpreadsheetLibrary';
import { CollabSpreadsheetLibraryDialog } from '@/components/meetings/CollabSpreadsheetLibraryDialog';
import { ChevronLeft, ChevronRight, ExternalLink, FileSpreadsheet, Link2, Loader2, Pencil, Plus, Stethoscope, Trash2, Users } from 'lucide-react';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek,
} from 'date-fns';

interface Meeting {
  id: string;
  scheduled_date: string;
  time_slot: string | null;
  notes: string | null;
  attendees: { id: string; provider_name: string; provider_email: string; notes: string | null; chart_link: string | null }[];
}

interface ProviderLink {
  state: string;
  physician: string;
  chartUrl: string | null;
}

const CollabMeetingSchedulePage = () => {
  const { profile, roles } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const meetingParam = searchParams.get('meeting');
  const dateParam = searchParams.get('date');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [linkEditKey, setLinkEditKey] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [editSlot, setEditSlot] = useState<'am' | 'pm'>('am');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const openEdit = (m: Meeting) => {
    setEditDate(format(new Date(m.scheduled_date), 'yyyy-MM-dd'));
    setEditSlot(m.time_slot === 'pm' ? 'pm' : 'am');
    setEditNotes(m.notes || '');
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!selected || !editDate) return;
    setSaving(true);
    try {
      const original = new Date(selected.scheduled_date);
      const newDate = new Date(`${editDate}T00:00:00`);
      if (editSlot !== (selected.time_slot === 'pm' ? 'pm' : 'am')) {
        // Switching sessions uses the standard meeting time (10:00 AM / 2:00 PM)
        const [h, m] = editSlot === 'am' ? [10, 0] : [14, 0];
        newDate.setHours(h, m, 0, 0);
      } else {
        newDate.setHours(original.getHours(), original.getMinutes(), 0, 0);
      }
      const { error } = await supabase
        .from('supervision_meetings')
        .update({ scheduled_date: newDate.toISOString(), time_slot: editSlot, notes: editNotes || null })
        .eq('id', selected.id);
      if (error) throw error;
      setEditOpen(false);
      setSelectedId(selected.id);
      queryClient.invalidateQueries({ queryKey: ['collab-meeting-schedule'] });
      toast({ title: 'Meeting updated' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to update meeting.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const deleteMeeting = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await supabase.from('meeting_attendees').delete().eq('meeting_id', selected.id);
      const { error } = await supabase.from('supervision_meetings').delete().eq('id', selected.id);
      if (error) throw error;
      setDeleteOpen(false);
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ['collab-meeting-schedule'] });
      toast({ title: 'Meeting deleted' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to delete meeting.', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  // Deep link from the Calendar page: jump to the meeting's month and select it
  useEffect(() => {
    if (dateParam) setMonth(startOfMonth(parseLocalDate(dateParam.slice(0, 10))));
    if (meetingParam) setSelectedId(meetingParam);
  }, [meetingParam, dateParam]);

  const rangeStart = startOfWeek(startOfMonth(month));
  const rangeEnd = endOfWeek(endOfMonth(month));

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ['collab-meeting-schedule', format(month, 'yyyy-MM')],
    queryFn: async (): Promise<Meeting[]> => {
      const { data, error } = await supabase
        .from('supervision_meetings')
        .select('id, scheduled_date, time_slot, notes, status, meeting_attendees(id, provider_name, provider_email, notes, chart_link)')
        .eq('is_company_wide', true)
        .neq('status', 'cancelled')
        .gte('scheduled_date', rangeStart.toISOString())
        .lte('scheduled_date', rangeEnd.toISOString())
        .order('scheduled_date');
      if (error) throw error;
      return (data || []).map((m: any) => ({
        id: m.id,
        scheduled_date: m.scheduled_date,
        time_slot: m.time_slot,
        notes: m.notes,
        attendees: m.meeting_attendees || [],
      }));
    },
  });

  // Provider email -> states, leading MD, chart link (from active agreements)
  const { data: providerLinks = new Map<string, ProviderLink[]>() } = useQuery({
    queryKey: ['collab-meeting-provider-links'],
    queryFn: async () => {
      const [{ data: aps }, { data: ags }] = await Promise.all([
        supabase.from('agreement_providers')
          .select('provider_id, provider_email, agreement_id, chart_review_url')
          .eq('is_active', true),
        supabase.from('collaborative_agreements')
          .select('id, state_abbreviation, physician_name, workflow_status, terminated_at')
          .in('workflow_status', ['active', 'pending_signatures', 'awaiting_provider_signatures', 'awaiting_physician_signature']),
      ]);
      const providerIds = [...new Set((aps || []).map((a) => a.provider_id).filter(Boolean))] as string[];
      const { data: profs } = providerIds.length
        ? await supabase.from('profiles').select('id, chart_review_folder_url').in('id', providerIds)
        : { data: [] as { id: string; chart_review_folder_url: string | null }[] };
      const folderMap = new Map((profs || []).map((p) => [p.id, p.chart_review_folder_url]));
      const agMap = new Map((ags || []).filter((a) => !a.terminated_at).map((a) => [a.id, a]));
      const map = new Map<string, ProviderLink[]>();
      (aps || []).forEach((ap) => {
        const ag = agMap.get(ap.agreement_id);
        if (!ag || !ap.provider_email) return;
        const key = ap.provider_email.toLowerCase();
        const list = map.get(key) || [];
        list.push({
          state: ag.state_abbreviation,
          physician: ag.physician_name || 'Unassigned MD',
          chartUrl: ap.chart_review_url || (ap.provider_id ? folderMap.get(ap.provider_id) : null) || null,
        });
        map.set(key, list);
      });
      return map;
    },
  });

  // Shared chart spreadsheet library (system_config), seeded with the shared Drive links
  const { data: library = [] } = useQuery({
    queryKey: ['system-config', COLLAB_SPREADSHEET_LIBRARY_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', COLLAB_SPREADSHEET_LIBRARY_KEY)
        .maybeSingle();
      if (error) throw error;
      return mergeLibraryDefaults((data?.value as any)?.spreadsheets);
    },
  });

  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
  const selected = meetings.find((m) => m.id === selectedId) || null;

  // Group selected meeting attendees by leading MD
  const groups = useMemo(() => {
    if (!selected) return [];
    const monthName = meetingMonthName(selected.scheduled_date);
    const byMd = new Map<string, { attendeeId: string; name: string; email: string; states: string[]; chartUrls: string[]; hasManual: boolean }[]>();
    selected.attendees.forEach((a) => {
      const links = providerLinks.get((a.provider_email || '').toLowerCase()) || [];
      meetingStateGroups(a.notes, links).forEach(([md, scope]) => {
        // Library month tabs win; agreement chart links cover states with no library match
        const libMatches = libraryUrlsForStates(library, scope.states, monthName);
        const libStates = new Set(libMatches.map((o) => o.state));
        const fallbackUrls = scope.states
          .filter((state) => !libStates.has(state))
          .flatMap((state) =>
            links.filter((link) => link.state === state && link.physician === md && link.chartUrl).map((link) => link.chartUrl as string),
          );
        // A manually saved link on the attendee wins over library/agreement links
        const manual = (a.chart_link || '').trim();
        const entry = {
          attendeeId: a.id,
          name: a.provider_name,
          email: a.provider_email,
          states: scope.states,
          chartUrls: manual ? [manual] : [...new Set([...libMatches.map((o) => o.url), ...fallbackUrls])],
          hasManual: !!manual,
        };
        byMd.set(md, [...(byMd.get(md) || []), entry]);
      });
    });
    return [...byMd.entries()]
      .map(([md, list]) => [md, list.sort((x, y) => x.name.localeCompare(y.name))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [selected, providerLinks, library]);

  const openCharts = (urls: (string | null)[]) => {
    [...new Set(urls.filter(Boolean) as string[])].forEach((u) => window.open(u, '_blank', 'noopener'));
  };

  const saveChartLink = async (attendeeId: string) => {
    const url = linkDraft.trim();
    const { error } = await supabase.from('meeting_attendees').update({ chart_link: url || null }).eq('id', attendeeId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    setLinkEditKey(null);
    setLinkDraft('');
    queryClient.invalidateQueries({ queryKey: ['collab-meeting-schedule'] });
    toast({ title: url ? 'Chart link saved' : 'Chart link removed' });
  };

  // ============= Add providers to the selected meeting =============
  const [addOpen, setAddOpen] = useState(false);
  const [addProviders, setAddProviders] = useState<{ id: string; name: string; email: string; states: string[] }[]>([]);
  const [addStates, setAddStates] = useState<Record<string, string[]>>({});
  const [addSearch, setAddSearch] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addSaving, setAddSaving] = useState(false);

  const openAdd = async () => {
    setAddOpen(true);
    setAddStates({});
    setAddSearch('');
    setAddLoading(true);
    try {
      const [{ data: aps }, { data: ags }] = await Promise.all([
        supabase.from('agreement_providers').select('id, provider_name, provider_email, agreement_id').eq('is_active', true),
        supabase.from('collaborative_agreements').select('id, state_abbreviation')
          .in('workflow_status', ['active', 'pending_signatures', 'awaiting_provider_signatures', 'awaiting_physician_signature']),
      ]);
      const agMap = new Map((ags || []).map((a) => [a.id, a.state_abbreviation]));
      const map = new Map<string, { id: string; name: string; email: string; states: string[] }>();
      (aps || []).forEach((ap) => {
        if (!ap.provider_email) return;
        const state = agMap.get(ap.agreement_id);
        if (!state) return;
        const email = ap.provider_email.toLowerCase();
        const existing = map.get(email);
        if (existing) {
          if (!existing.states.includes(state)) existing.states.push(state);
        } else {
          map.set(email, { id: ap.id, name: ap.provider_name || ap.provider_email, email: ap.provider_email, states: [state] });
        }
      });
      setAddProviders([...map.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to load providers.', variant: 'destructive' });
    } finally {
      setAddLoading(false);
    }
  };

  const existingStatesFor = (email: string) =>
    new Set(
      (selected?.attendees || [])
        .filter((a) => (a.provider_email || '').toLowerCase() === email.toLowerCase())
        .flatMap((a) => selectedMeetingStates(a.notes)),
    );

  const toggleAddState = (email: string, state: string) => {
    setAddStates((prev) => {
      const cur = prev[email] || [];
      const next = cur.includes(state) ? cur.filter((s) => s !== state) : [...cur, state];
      return { ...prev, [email]: next };
    });
  };

  const saveNewProviders = async () => {
    if (!selected) return;
    const pending = addProviders.filter((p) => (addStates[p.email] || []).length > 0);
    if (!pending.length) return;
    setAddSaving(true);
    try {
      for (const p of pending) {
        const newStates = [...(addStates[p.email] || [])].sort();
        const existing = selected.attendees.filter((a) => (a.provider_email || '').toLowerCase() === p.email.toLowerCase());
        if (existing.length) {
          // Provider already attends: merge the new states into their saved states
          const merged = [...new Set([...existing.flatMap((a) => selectedMeetingStates(a.notes)), ...newStates])].sort();
          const { error } = await supabase
            .from('meeting_attendees')
            .update({ notes: `States: ${merged.join(', ')}` })
            .eq('id', existing[0].id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('meeting_attendees').insert({
            meeting_id: selected.id,
            provider_id: p.id,
            provider_name: p.name,
            provider_email: p.email,
            attendance_status: 'invited',
            has_rsvped: false,
            notes: `States: ${newStates.join(', ')}`,
          });
          if (error) throw error;
        }
      }
      setAddOpen(false);
      queryClient.invalidateQueries({ queryKey: ['collab-meeting-schedule'] });
      toast({ title: 'Providers added' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to add providers.', variant: 'destructive' });
    } finally {
      setAddSaving(false);
    }
  };

  const visibleAddProviders = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return q ? addProviders.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) : addProviders;
  }, [addProviders, addSearch]);
  // ============= End add providers =============

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={(roles.includes('admin') ? 'admin' : roles[0] || 'admin') as any}
        userName={profile?.full_name || profile?.email || ''}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      <main className="ml-0 sm:ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Collab Meeting Schedule</h1>
              <p className="text-muted-foreground text-sm">Who should attend each collaborative meeting, grouped by the leading MD.</p>
            </div>
            <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setLibraryOpen(true)}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Chart spreadsheets
            </Button>
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Schedule Meeting
            </Button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <Button variant="ghost" size="icon" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <CardTitle className="text-lg">{format(month, 'MMMM yyyy')}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (
                  <div className="grid grid-cols-7 gap-px rounded-md border bg-border overflow-hidden">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                      <div key={d} className="bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{d}</div>
                    ))}
                    {days.map((day) => {
                      const dayMeetings = meetings.filter((m) => isSameDay(new Date(m.scheduled_date), day));
                      return (
                        <div key={day.toISOString()} className={cn('bg-card min-h-24 p-1.5 space-y-1', !isSameMonth(day, month) && 'opacity-40')}>
                          <div className={cn('text-xs', isSameDay(day, new Date()) && 'font-bold text-primary')}>{format(day, 'd')}</div>
                          {dayMeetings.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => setSelectedId(m.id)}
                              className={cn(
                                'w-full text-left rounded px-1.5 py-1 text-xs bg-primary/10 text-primary hover:bg-primary/20',
                                selectedId === m.id && 'ring-2 ring-primary',
                              )}
                            >
                              <div className="font-medium">{format(new Date(m.scheduled_date), 'h:mm a')} Collab</div>
                              <div className="text-muted-foreground">{m.attendees.length} attending</div>
                              <div className="break-words">{[...new Set(m.attendees.flatMap(a => selectedMeetingStates(a.notes)))].sort().join(', ')}</div>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {selected ? format(new Date(selected.scheduled_date), 'EEE, MMM d · h:mm a') : 'Select a meeting'}
                </CardTitle>
                {selected && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={!groups.some(([, list]) => list.some(p => p.chartUrls.length))}
                    onClick={() => openCharts(groups.flatMap(([, list]) => list.flatMap((p) => p.chartUrls)))}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open all chart spreadsheets
                  </Button>
                )}
                {selected && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(selected)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {!selected && <p className="text-sm text-muted-foreground">Click a meeting on the calendar to see who should attend.</p>}
                {selected && selected.attendees.length === 0 && <p className="text-sm text-muted-foreground">No attendees on this meeting.</p>}
                {selected?.notes && <p className="text-sm text-muted-foreground">{selected.notes}</p>}
                {groups.map(([md, list]) => (
                  <div key={md} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Stethoscope className="h-4 w-4 text-primary" /> {md}
                        <Badge variant="secondary">{list.length}</Badge>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {list.map((p) => (
                        <div key={md + p.email} className="flex items-center justify-between gap-2 rounded border p-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{p.name}</p>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {p.states.map((s) => <Badge key={s} variant="outline" className="text-[10px] px-1">{s}</Badge>)}
                            </div>
                          </div>
                          {linkEditKey === p.attendeeId ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={linkDraft}
                                onChange={(e) => setLinkDraft(e.target.value)}
                                placeholder="Paste chart link"
                                className="h-8 w-44 text-xs"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') saveChartLink(p.attendeeId); }}
                              />
                              <Button size="sm" className="h-8" onClick={() => saveChartLink(p.attendeeId)}>Save</Button>
                              <Button size="sm" variant="ghost" className="h-8" onClick={() => setLinkEditKey(null)}>Cancel</Button>
                            </div>
                          ) : p.chartUrls.length ? (
                            <div className="flex items-center">
                              <Button variant="ghost" size="sm" onClick={() => openCharts(p.chartUrls)}>
                                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Charts
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                aria-label="Edit chart link"
                                onClick={() => { setLinkEditKey(p.attendeeId); setLinkDraft(p.hasManual ? p.chartUrls[0] : ''); }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-muted-foreground"
                              onClick={() => { setLinkEditKey(p.attendeeId); setLinkDraft(''); }}
                            >
                              <Link2 className="h-3.5 w-3.5 mr-1" /> Add link
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit meeting</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-date">Date</Label>
              <Input id="edit-date" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Select value={editSlot} onValueChange={(v: 'am' | 'pm') => setEditSlot(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="am">Morning (10:00 AM)</SelectItem>
                  <SelectItem value="pm">Afternoon (2:00 PM)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea id="edit-notes" rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Optional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving || !editDate}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected && `${format(new Date(selected.scheduled_date), 'EEEE, MMMM d')} at ${format(new Date(selected.scheduled_date), 'h:mm a')} will be removed from the calendar, along with its attendee list. This can't be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); deleteMeeting(); }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Yes, delete it'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CollabSpreadsheetLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} />

      <CompanyMeetingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        calendarOnly
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['collab-meeting-schedule'] })}
      />
    </div>
  );
};

export default CollabMeetingSchedulePage;
