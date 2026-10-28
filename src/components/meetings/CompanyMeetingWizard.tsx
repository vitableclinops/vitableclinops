import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Calendar as CalendarIcon,
  Clock,
  Users,
  ChevronRight,
  ChevronLeft,
  Check,
  Sun,
  Moon,
  Info,
  Mail,
  Copy,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, addMonths, startOfMonth, getDate } from 'date-fns';

// Fixed time slots for company-wide meetings
const AM_TIME = '10:00';
const PM_TIME = '14:00';

// Format a 24h "HH:mm" string as a 12-hour label, e.g. "10:00 AM"
const fmt12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

// All selectable meeting times: 12:00 AM through 11:30 PM in 30-minute steps
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`
);

interface ProviderForMeeting {
  id: string;
  name: string;
  email: string;
  states: string[]; // All states this provider has agreements in
  requiredStates: string[]; // States that require a meeting this month
  isRequired: boolean; // Whether provider needs to attend this month
}

interface CompanyMeetingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  /** Only add the meeting to the calendar — skip the notify/email step */
  calendarOnly?: boolean;
}

type WizardStep = 'date' | 'attendees' | 'review' | 'notify';

export function CompanyMeetingWizard({ 
  open, 
  onOpenChange, 
  onSuccess,
  calendarOnly = false,
}: CompanyMeetingWizardProps) {
  const { toast } = useToast();
  
  const [step, setStep] = useState<WizardStep>('date');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [selectedTime, setSelectedTime] = useState('10:00');
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<ProviderForMeeting[]>([]);
  const [selectedAttendees, setSelectedAttendees] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [createdMeetingIds, setCreatedMeetingIds] = useState<string[] | null>(null);
  const [emailsCopied, setEmailsCopied] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('date');
      setSelectedDate(undefined);
      setNotes('');
      setSelectedTime('10:00');
      setCreatedMeetingIds(null);
      setEmailsCopied(false);
      setSelectedAttendees(new Set());
      suggestNextDate();
    }
  }, [open]);

  // Reload providers when date changes to recalculate who's required
  useEffect(() => {
    if (open && selectedDate) {
      loadProviders();
    }
  }, [selectedDate]);

  // Load all active providers with their states and determine if required for this month
  const loadProviders = async () => {
    setLoading(true);
    try {
      // Get all active agreement providers with their agreements
      const { data: agreementProviders, error } = await supabase
        .from('agreement_providers')
        .select(`
          id,
          provider_id,
          provider_name,
          provider_email,
          is_active,
          agreement_id
        `)
        .eq('is_active', true);
      
      if (error) throw error;

      // Get agreement details for state info
      const { data: agreements } = await supabase
        .from('collaborative_agreements')
        .select('id, state_abbreviation, workflow_status')
        .in('workflow_status', ['active', 'pending_signatures', 'awaiting_provider_signatures', 'awaiting_physician_signature']);
      
      if (!agreements) {
        setProviders([]);
        return;
      }

      // Get state compliance requirements for meeting months
      const stateAbbrs = [...new Set(agreements.map(a => a.state_abbreviation))];
      const { data: stateCompliance } = await supabase
        .from('state_compliance_requirements')
        .select('state_abbreviation, meeting_months')
        .in('state_abbreviation', stateAbbrs);

      // Create state -> meeting months map
      const stateMonthMap = new Map<string, number[]>();
      stateCompliance?.forEach(sc => {
        stateMonthMap.set(sc.state_abbreviation, sc.meeting_months || []);
      });

      // Determine which month we're scheduling for (default to next month)
      const meetingMonth = selectedDate ? (selectedDate.getMonth() + 1) : ((new Date().getMonth() + 2) % 12 || 12);

      // Group providers and their states
      const providerMap = new Map<string, ProviderForMeeting>();
      
      agreementProviders?.forEach(ap => {
        const agreement = agreements.find(a => a.id === ap.agreement_id);
        if (!agreement) return;
        
        const stateMonths = stateMonthMap.get(agreement.state_abbreviation) || [];
        // If no months specified or empty array, default to monthly (all months required)
        const isRequiredForState = stateMonths.length === 0 || stateMonths.includes(meetingMonth);
        
        const existing = providerMap.get(ap.provider_email);
        if (existing) {
          if (!existing.states.includes(agreement.state_abbreviation)) {
            existing.states.push(agreement.state_abbreviation);
          }
          if (isRequiredForState && !existing.requiredStates.includes(agreement.state_abbreviation)) {
            existing.requiredStates.push(agreement.state_abbreviation);
            existing.isRequired = true;
          }
        } else {
          providerMap.set(ap.provider_email, {
            id: ap.id,
            name: ap.provider_name,
            email: ap.provider_email,
            states: [agreement.state_abbreviation],
            requiredStates: isRequiredForState ? [agreement.state_abbreviation] : [],
            isRequired: isRequiredForState,
          });
        }
      });

      const providerList = Array.from(providerMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      setProviders(providerList);
      setSelectedAttendees(new Set(providerList.filter(p => p.isRequired).map(p => p.email)));
    } catch (err) {
      console.error('Error loading providers:', err);
      toast({
        title: 'Error',
        description: 'Failed to load providers.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Suggest next meeting date based on monthly cadence
  const suggestNextDate = async () => {
    try {
      // Get the last company-wide meeting
      const { data: lastMeeting } = await supabase
        .from('supervision_meetings')
        .select('scheduled_date')
        .eq('is_company_wide', true)
        .order('scheduled_date', { ascending: false })
        .limit(1)
        .single();
      
      if (lastMeeting) {
        // Suggest 1 month from last meeting
        const lastDate = new Date(lastMeeting.scheduled_date);
        setSelectedDate(addMonths(lastDate, 1));
      } else {
        // Default to first of next month
        const nextMonth = addMonths(new Date(), 1);
        setSelectedDate(startOfMonth(nextMonth));
      }
    } catch {
      // No previous meeting, suggest first of next month
      const nextMonth = addMonths(new Date(), 1);
      setSelectedDate(startOfMonth(nextMonth));
    }
  };

  // Get only required providers for invitations
  const requiredProviders = useMemo(() => {
    return providers.filter(p => p.isRequired);
  }, [providers]);

  const nonRequiredProviders = useMemo(() => {
    return providers.filter(p => !p.isRequired);
  }, [providers]);

  // Providers the user chose to invite (defaults to the required providers)
  const invitedProviders = useMemo(() => {
    return providers.filter(p => selectedAttendees.has(p.email));
  }, [providers, selectedAttendees]);

  const toggleAttendee = (email: string) => {
    setSelectedAttendees(prev => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  };

  const selectAllAttendees = (emails: string[]) => setSelectedAttendees(new Set(emails));

  // Generate email list for invited providers only
  const emailList = useMemo(() => {
    return invitedProviders.map(p => p.email).join(', ');
  }, [invitedProviders]);

  // Copy emails to clipboard
  const copyEmails = async () => {
    try {
      await navigator.clipboard.writeText(emailList);
      setEmailsCopied(true);
      toast({
        title: 'Copied!',
        description: `${invitedProviders.length} email addresses copied to clipboard.`,
      });
      setTimeout(() => setEmailsCopied(false), 3000);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to copy emails.',
        variant: 'destructive',
      });
    }
  };

  // Download email list as CSV
  const downloadEmailsCsv = () => {
    const csvContent = [
      ['Name', 'Email', 'Required States', 'All States'].join(','),
      ...invitedProviders.map(p => [
        `"${p.name}"`,
        p.email,
        `"${p.requiredStates.join(', ')}"`,
        `"${p.states.join(', ')}"`,
      ].join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-attendees-${format(selectedDate || new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: 'Downloaded',
      description: `${invitedProviders.length} providers exported to CSV.`,
    });
  };

  // The single selected time slot to create
  const getTimeSessions = (): { slot: 'am' | 'pm'; time: string }[] => {
    const t = selectedTime || '10:00';
    return [{ slot: parseInt(t, 10) < 12 ? 'am' : 'pm', time: t }];
  };

  const handleSubmit = async () => {
    if (!selectedDate) return;
    
    setSubmitting(true);
    
    try {
      const baseDate = new Date(selectedDate);
      
      // Resolve the placeholder agreement_id once for all meetings
      const { data: placeholderAgreement } = await supabase
        .from('collaborative_agreements')
        .select('id')
        .in('workflow_status', ['active'])
        .limit(1)
        .single();

      // Create one meeting per selected time slot
      const sessions = getTimeSessions();
      const created: any[] = [];
      for (const session of sessions) {
        const meetingDate = new Date(baseDate);
        const [hours, minutes] = session.time.split(':').map(Number);
        meetingDate.setHours(hours, minutes, 0, 0);

        const { data: meeting, error: meetingError } = await supabase
          .from('supervision_meetings')
          .insert({
            scheduled_date: meetingDate.toISOString(),
            time_slot: session.slot,
            meeting_type: 'collaborative_meeting',
            status: 'scheduled',
            notes: notes || null,
            is_company_wide: true,
            meeting_month: format(selectedDate, 'yyyy-MM-01'),
            agreement_id: placeholderAgreement?.id || null,
          })
          .select()
          .single();

        if (meetingError) throw meetingError;
        created.push(meeting);
      }

      // Add the selected providers as invited attendees to each created meeting
      if (invitedProviders.length > 0 && created.length > 0) {
        const attendeeInserts = created.flatMap((meeting) =>
          invitedProviders.map(provider => ({
            meeting_id: meeting.id,
            provider_id: provider.id,
            provider_name: provider.name,
            provider_email: provider.email,
            attendance_status: 'invited',
            has_rsvped: false,
          }))
        );

        const { error: attendeeError } = await supabase
          .from('meeting_attendees')
          .insert(attendeeInserts);

        if (attendeeError) throw attendeeError;
      }

      setCreatedMeetingIds(created.map((m) => m.id));
      if (calendarOnly) {
        onSuccess();
        onOpenChange(false);
      } else {
        setStep('notify');
      }

      toast({
        title: 'Meeting scheduled',
        description: `Collaborative meeting scheduled for ${format(selectedDate, 'MMMM d, yyyy')} at ${sessions.map((s) => `${fmt12(s.time)} ET`).join(' & ')}.`,
      });
    } catch (error) {
      console.error('Error scheduling meetings:', error);
      toast({
        title: 'Error',
        description: 'Failed to schedule meetings. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 'date':
        return selectedDate !== undefined && (timeChoice !== 'custom' || customTime !== '');
      case 'attendees':
        return selectedAttendees.size > 0;
      case 'review':
        return true;
      case 'notify':
        return true;
      default:
        return false;
    }
  };

  const goNext = () => {
    const steps: WizardStep[] = ['date', 'attendees', 'review', 'notify'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      if (step === 'review') {
        handleSubmit();
      } else {
        setStep(steps[currentIndex + 1]);
      }
    }
  };

  const goBack = () => {
    const steps: WizardStep[] = ['date', 'attendees', 'review', 'notify'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const handleClose = () => {
    if (createdMeetingIds) {
      onSuccess();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[95vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Schedule Company-Wide Collaborative Meeting
          </DialogTitle>
          <DialogDescription>
            {step === 'date' && 'Select the date for the monthly collaborative meeting.'}
            {step === 'attendees' && 'Choose who should be invited to this meeting.'}
            {step === 'review' && 'Review the meeting details before scheduling.'}
            {step === 'notify' && 'Meeting scheduled! Send notifications to providers.'}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicators */}
        <div className="flex items-center justify-center gap-2 py-2">
          {(['date', 'attendees', 'review', 'notify'] as WizardStep[]).map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  step === s
                    ? 'bg-primary text-primary-foreground'
                    : i < ['date', 'attendees', 'review', 'notify'].indexOf(step)
                    ? 'bg-green-500 text-white'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {i < ['date', 'attendees', 'review', 'notify'].indexOf(step) ? (
                  <Check className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              {i < 3 && (
                <div
                  className={cn(
                    'w-12 h-0.5 mx-1',
                    i < ['date', 'attendees', 'review', 'notify'].indexOf(step)
                      ? 'bg-green-500'
                      : 'bg-muted'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <ScrollArea className="flex-1 min-h-0 pr-4">
          {/* Step 1: Select Date */}
          {step === 'date' && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                {loading ? 'Loading providers...' : (
                  <>
                    <strong>{requiredProviders.length}</strong> providers require a meeting this month based on their state cadences.
                    {nonRequiredProviders.length > 0 && (
                      <span> ({nonRequiredProviders.length} not required this month)</span>
                    )}
                  </>
                )}
              </p>

              <div className="flex flex-col items-center gap-4">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="rounded-md border"
                  disabled={(date) => date < new Date()}
                />
                <div className="w-full space-y-1.5">
                  <Label>Meeting Time (Eastern Time)</Label>
                  <Select value={timeChoice} onValueChange={(v) => setTimeChoice(v as 'both' | 'am' | 'pm' | 'custom')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both">Both — {fmt12(AM_TIME)} & {fmt12(PM_TIME)} ET</SelectItem>
                      <SelectItem value="am">Morning only — {fmt12(AM_TIME)} ET</SelectItem>
                      <SelectItem value="pm">Afternoon only — {fmt12(PM_TIME)} ET</SelectItem>
                      <SelectItem value="custom">Custom time…</SelectItem>
                    </SelectContent>
                  </Select>
                  {timeChoice === 'custom' && (
                    <Input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} />
                  )}
                </div>
                {selectedDate && (
                  <div className="text-center">
                    <p className="text-lg font-semibold">
                      {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                    </p>
                    <div className="flex items-center justify-center gap-4 mt-2 text-sm text-muted-foreground">
                      {getTimeSessions().map((s) => (
                        <span key={s.slot} className="flex items-center gap-1">
                          {s.slot === 'am' ? <Sun className="h-4 w-4 text-amber-500" /> : <Moon className="h-4 w-4 text-indigo-500" />}
                          {fmt12(s.time)} ET
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* Step 2: Select Attendees */}
          {step === 'attendees' && (
            <div className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Pick exactly who should be invited. Providers required this month are pre-selected.
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectAllAttendees(providers.filter(p => p.isRequired).map(p => p.email))}
                >
                  Required only ({requiredProviders.length})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectAllAttendees(providers.map(p => p.email))}
                >
                  Select all ({providers.length})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedAttendees(new Set())}
                >
                  Clear
                </Button>
              </div>

              <div className="space-y-2">
                {providers.map(provider => {
                  const isSelected = selectedAttendees.has(provider.email);
                  return (
                    <div
                      key={provider.email}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                        isSelected ? 'border-primary bg-primary/5' : 'bg-card'
                      )}
                      onClick={() => toggleAttendee(provider.email)}
                    >
                      <Checkbox checked={isSelected} className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm">{provider.name}</p>
                          {provider.isRequired && (
                            <Badge variant="secondary" className="text-xs">
                              Required this month
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{provider.email}</p>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {provider.states.map(state => (
                            <Badge key={state} variant="outline" className="text-xs">
                              {state}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {providers.length === 0 && !loading && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No providers found.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Meeting Notes (optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes or agenda items for this meeting..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 'review' && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Meeting Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground text-xs">Date</Label>
                      <p className="font-medium">
                        {selectedDate ? format(selectedDate, 'MMMM d, yyyy') : 'Not selected'}
                      </p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">Time (Eastern)</Label>
                      <p className="font-medium">{getTimeSessions().map((s) => `${fmt12(s.time)} ET`).join(' & ')}</p>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div>
                    <Label className="text-muted-foreground text-xs">Providers to be Invited</Label>
                    <p className="font-medium">{invitedProviders.length} provider{invitedProviders.length !== 1 ? 's' : ''} selected</p>
                    {providers.length - invitedProviders.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {providers.length - invitedProviders.length} provider{providers.length - invitedProviders.length !== 1 ? 's' : ''} not invited
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {invitedProviders.slice(0, 5).map(p => (
                        <Badge key={p.email} variant="secondary" className="text-xs">
                          {p.name} ({p.requiredStates.join(', ')})
                        </Badge>
                      ))}
                      {invitedProviders.length > 5 && (
                        <Badge variant="outline" className="text-xs">
                          +{invitedProviders.length - 5} more
                        </Badge>
                      )}
                    </div>
                  </div>

                  {notes && (
                    <>
                      <Separator />
                      <div>
                        <Label className="text-muted-foreground text-xs">Notes</Label>
                        <p className="text-sm">{notes}</p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  {calendarOnly
                    ? `Providers will be added to the ${timeChoice === 'both' ? 'both time slots' : 'selected time slot'} on the calendar. No emails are sent.`
                    : `Providers will be added to the ${timeChoice === 'both' ? 'both time slots' : 'selected time slot'}. After scheduling, you'll get a list of emails to notify them externally.`}
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Step 3: Notify */}
          {step === 'notify' && (
            <div className="space-y-6">
              <Alert className="bg-green-50 border-green-200">
                <Check className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  Meeting scheduled successfully for {selectedDate ? format(selectedDate, 'MMMM d, yyyy') : ''}!
                  Now send notifications to providers.
                </AlertDescription>
              </Alert>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Provider Email List
                  </CardTitle>
                  <CardDescription>
                    Copy these emails to send meeting invitations externally
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={copyEmails}
                      className="flex-1"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      {emailsCopied ? 'Copied!' : 'Copy All Emails'}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={downloadEmailsCsv}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download CSV
                    </Button>
                  </div>

                  <div className="bg-muted p-3 rounded-lg max-h-40 overflow-y-auto">
                    <p className="text-xs font-mono break-all text-muted-foreground">
                      {emailList}
                    </p>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      {invitedProviders.length} Providers to Notify
                    </Label>
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {invitedProviders.map(provider => (
                          <div 
                            key={provider.email}
                            className="flex items-center justify-between p-2 rounded border bg-card"
                          >
                            <div>
                              <p className="font-medium text-sm">{provider.name}</p>
                              <p className="text-xs text-muted-foreground">{provider.email}</p>
                            </div>
                            <div className="flex gap-1">
                              {provider.states.slice(0, 3).map(state => (
                                <Badge key={state} variant="outline" className="text-xs">
                                  {state}
                                </Badge>
                              ))}
                              {provider.states.length > 3 && (
                                <Badge variant="secondary" className="text-xs">
                                  +{provider.states.length - 3}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="mt-6">
          {step !== 'notify' ? (
            <>
              <Button
                variant="outline"
                onClick={step === 'date' ? () => onOpenChange(false) : goBack}
              >
                {step === 'date' ? 'Cancel' : (
                  <>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back
                  </>
                )}
              </Button>
              <Button
                onClick={goNext}
                disabled={!canProceed() || submitting}
              >
                {step === 'review' ? (
                  submitting ? 'Scheduling...' : 'Schedule Meeting'
                ) : (
                  <>
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
