import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

interface ProviderForMeeting {
  id: string;
  name: string;
  email: string;
  states: string[]; // All states this provider has agreements in
}

interface CompanyMeetingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type WizardStep = 'date' | 'review' | 'notify';

export function CompanyMeetingWizard({ 
  open, 
  onOpenChange, 
  onSuccess,
}: CompanyMeetingWizardProps) {
  const { toast } = useToast();
  
  const [step, setStep] = useState<WizardStep>('date');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<ProviderForMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [createdMeetingIds, setCreatedMeetingIds] = useState<{ am: string; pm: string } | null>(null);
  const [emailsCopied, setEmailsCopied] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('date');
      setSelectedDate(undefined);
      setNotes('');
      setCreatedMeetingIds(null);
      setEmailsCopied(false);
      loadProviders();
      suggestNextDate();
    }
  }, [open]);

  // Load all active providers with their states
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

      // Group providers and their states
      const providerMap = new Map<string, ProviderForMeeting>();
      
      agreementProviders?.forEach(ap => {
        const agreement = agreements.find(a => a.id === ap.agreement_id);
        if (!agreement) return;
        
        const existing = providerMap.get(ap.provider_email);
        if (existing) {
          if (!existing.states.includes(agreement.state_abbreviation)) {
            existing.states.push(agreement.state_abbreviation);
          }
        } else {
          providerMap.set(ap.provider_email, {
            id: ap.id,
            name: ap.provider_name,
            email: ap.provider_email,
            states: [agreement.state_abbreviation],
          });
        }
      });

      setProviders(Array.from(providerMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
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

  // Generate email list
  const emailList = useMemo(() => {
    return providers.map(p => p.email).join(', ');
  }, [providers]);

  // Copy emails to clipboard
  const copyEmails = async () => {
    try {
      await navigator.clipboard.writeText(emailList);
      setEmailsCopied(true);
      toast({
        title: 'Copied!',
        description: `${providers.length} email addresses copied to clipboard.`,
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
      ['Name', 'Email', 'States'].join(','),
      ...providers.map(p => [
        `"${p.name}"`,
        p.email,
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
      description: 'Email list exported to CSV.',
    });
  };

  const handleSubmit = async () => {
    if (!selectedDate) return;
    
    setSubmitting(true);
    
    try {
      const baseDate = new Date(selectedDate);
      
      // Create AM meeting
      const amDate = new Date(baseDate);
      const [amHours, amMinutes] = AM_TIME.split(':').map(Number);
      amDate.setHours(amHours, amMinutes, 0, 0);
      
      const { data: amMeeting, error: amError } = await supabase
        .from('supervision_meetings')
        .insert({
          scheduled_date: amDate.toISOString(),
          time_slot: 'am',
          meeting_type: 'collaborative_meeting',
          status: 'scheduled',
          notes: notes || null,
          is_company_wide: true,
          meeting_month: format(selectedDate, 'yyyy-MM-01'),
          // Use a placeholder agreement_id (first active agreement) for backward compatibility
          agreement_id: (await supabase
            .from('collaborative_agreements')
            .select('id')
            .in('workflow_status', ['active'])
            .limit(1)
            .single()).data?.id || null,
        })
        .select()
        .single();
      
      if (amError) throw amError;
      
      // Create PM meeting
      const pmDate = new Date(baseDate);
      const [pmHours, pmMinutes] = PM_TIME.split(':').map(Number);
      pmDate.setHours(pmHours, pmMinutes, 0, 0);
      
      const { data: pmMeeting, error: pmError } = await supabase
        .from('supervision_meetings')
        .insert({
          scheduled_date: pmDate.toISOString(),
          time_slot: 'pm',
          meeting_type: 'collaborative_meeting',
          status: 'scheduled',
          notes: notes || null,
          is_company_wide: true,
          meeting_month: format(selectedDate, 'yyyy-MM-01'),
          agreement_id: amMeeting?.agreement_id || null,
        })
        .select()
        .single();
      
      if (pmError) throw pmError;
      
      // Add all providers as invited attendees to both meetings
      if (providers.length > 0 && amMeeting && pmMeeting) {
        const attendeeInserts = providers.flatMap(provider => [
          {
            meeting_id: amMeeting.id,
            provider_id: provider.id,
            provider_name: provider.name,
            provider_email: provider.email,
            attendance_status: 'invited',
            has_rsvped: false,
          },
          {
            meeting_id: pmMeeting.id,
            provider_id: provider.id,
            provider_name: provider.name,
            provider_email: provider.email,
            attendance_status: 'invited',
            has_rsvped: false,
          },
        ]);
        
        const { error: attendeeError } = await supabase
          .from('meeting_attendees')
          .insert(attendeeInserts);
        
        if (attendeeError) throw attendeeError;
      }
      
      setCreatedMeetingIds({ am: amMeeting.id, pm: pmMeeting.id });
      setStep('notify');
      
      toast({
        title: 'Meeting scheduled',
        description: `Collaborative meetings scheduled for ${format(selectedDate, 'MMMM d, yyyy')} at ${AM_TIME} and ${PM_TIME}.`,
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
        return selectedDate !== undefined;
      case 'review':
        return true;
      case 'notify':
        return true;
      default:
        return false;
    }
  };

  const goNext = () => {
    const steps: WizardStep[] = ['date', 'review', 'notify'];
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
    const steps: WizardStep[] = ['date', 'review', 'notify'];
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
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Schedule Company-Wide Collaborative Meeting
          </DialogTitle>
          <DialogDescription>
            {step === 'date' && 'Select the date for the monthly collaborative meeting.'}
            {step === 'review' && 'Review the meeting details before scheduling.'}
            {step === 'notify' && 'Meeting scheduled! Send notifications to providers.'}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicators */}
        <div className="flex items-center justify-center gap-2 py-4">
          {(['date', 'review', 'notify'] as WizardStep[]).map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  step === s
                    ? 'bg-primary text-primary-foreground'
                    : i < ['date', 'review', 'notify'].indexOf(step)
                    ? 'bg-green-500 text-white'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {i < ['date', 'review', 'notify'].indexOf(step) ? (
                  <Check className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              {i < 2 && (
                <div
                  className={cn(
                    'w-12 h-0.5 mx-1',
                    i < ['date', 'review', 'notify'].indexOf(step)
                      ? 'bg-green-500'
                      : 'bg-muted'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <ScrollArea className="flex-1 pr-4">
          {/* Step 1: Select Date */}
          {step === 'date' && (
            <div className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  This will schedule two meeting slots (AM at {AM_TIME} and PM at {PM_TIME}) 
                  for all {providers.length} active providers across all states.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col items-center gap-4">
                <Label className="text-base font-medium">Meeting Date</Label>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="rounded-md border"
                  disabled={(date) => date < new Date()}
                />
                {selectedDate && (
                  <div className="text-center">
                    <p className="text-lg font-semibold">
                      {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                    </p>
                    <div className="flex items-center justify-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Sun className="h-4 w-4 text-amber-500" />
                        AM: {AM_TIME}
                      </span>
                      <span className="flex items-center gap-1">
                        <Moon className="h-4 w-4 text-indigo-500" />
                        PM: {PM_TIME}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Meeting Notes (optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes or agenda items for this meeting..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Step 2: Review */}
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
                      <Label className="text-muted-foreground text-xs">Time Slots</Label>
                      <p className="font-medium">AM ({AM_TIME}) & PM ({PM_TIME})</p>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div>
                    <Label className="text-muted-foreground text-xs">Providers to be Invited</Label>
                    <p className="font-medium">{providers.length} providers</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {providers.slice(0, 5).map(p => (
                        <Badge key={p.email} variant="secondary" className="text-xs">
                          {p.name}
                        </Badge>
                      ))}
                      {providers.length > 5 && (
                        <Badge variant="outline" className="text-xs">
                          +{providers.length - 5} more
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
                  Providers will be added to both time slots. After scheduling, 
                  you'll get a list of emails to notify them externally.
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
                      {providers.length} Providers to Notify
                    </Label>
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {providers.map(provider => (
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
