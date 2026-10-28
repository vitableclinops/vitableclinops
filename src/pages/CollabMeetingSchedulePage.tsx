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
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Pencil, Plus, Stethoscope, Trash2, Users } from 'lucide-react';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek,
} from 'date-fns';

interface Meeting {
  id: string;
  scheduled_date: string;
  time_slot: string | null;
  notes: string | null;
  attendees: { provider_name: string; provider_email: string }[];
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
        .select('id, scheduled_date, time_slot, notes, status, meeting_attendees(provider_name, provider_email)')
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

  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
  const selected = meetings.find((m) => m.id === selectedId) || null;

  // Group selected meeting attendees by leading MD
  const groups = useMemo(() => {
    if (!selected) return [];
    const byMd = new Map<string, { name: string; email: string; states: string[]; chartUrl: string | null }[]>();
    selected.attendees.forEach((a) => {
      const links = providerLinks.get((a.provider_email || '').toLowerCase()) || [];
      const mds = links.length ? [...new Set(links.map((l) => l.physician))] : ['No active agreement'];
      mds.forEach((md) => {
        const mine = links.filter((l) => l.physician === md);
        const entry = {
          name: a.provider_name,
          email: a.provider_email,
          states: [...new Set(mine.map((l) => l.state))].sort(),
          chartUrl: mine.find((l) => l.chartUrl)?.chartUrl || links.find((l) => l.chartUrl)?.chartUrl || null,
        };
        byMd.set(md, [...(byMd.get(md) || []), entry]);
      });
    });
    return [...byMd.entries()]
      .map(([md, list]) => [md, list.sort((x, y) => x.name.localeCompare(y.name))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [selected, providerLinks]);

  const openCharts = (urls: (string | null)[]) => {
    [...new Set(urls.filter(Boolean) as string[])].forEach((u) => window.open(u, '_blank', 'noopener'));
  };

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
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Schedule Meeting
            </Button>
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
                    onClick={() => openCharts(groups.flatMap(([, list]) => list.map((p) => p.chartUrl)))}
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
                          {p.chartUrl ? (
                            <Button variant="ghost" size="sm" onClick={() => openCharts([p.chartUrl])}>
                              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Charts
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">No chart link</span>
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
