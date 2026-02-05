import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useStateCompliance } from '@/hooks/useStateCompliance';
import {
  Calendar as CalendarIcon,
  Clock,
  Users,
  MapPin,
  ChevronRight,
  ChevronLeft,
  Check,
  Sun,
  Moon,
  AlertCircle,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, addDays, addWeeks, addMonths, startOfWeek, getDay } from 'date-fns';

// Fixed time slots
const AM_TIME = '10:00';
const PM_TIME = '14:00';

interface StateWithProviders {
  abbreviation: string;
  name: string;
  meetingCadence: string | null;
  providers: {
    id: string;
    name: string;
    email: string;
    agreementId: string;
  }[];
  suggestedDate: Date | null;
  lastMeetingDate: Date | null;
}

interface ScheduleMeetingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  // Pass in provider/agreement data to know which states have active agreements
  agreements: {
    id: string;
    stateAbbreviation: string;
    stateName: string;
    providerId: string;
    providerName: string;
    providerEmail: string;
  }[];
}

type WizardStep = 'states' | 'date' | 'providers' | 'review';

export function ScheduleMeetingWizard({ 
  open, 
  onOpenChange, 
  onSuccess,
  agreements 
}: ScheduleMeetingWizardProps) {
  const { toast } = useToast();
  const { allData: stateComplianceData } = useStateCompliance();
  
  const [step, setStep] = useState<WizardStep>('states');
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedSlots, setSelectedSlots] = useState<Record<string, 'am' | 'pm' | 'both'>>({});
  const [providerAssignments, setProviderAssignments] = useState<Record<string, Record<string, 'am' | 'pm'>>>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastMeetings, setLastMeetings] = useState<Record<string, Date | null>>({});

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('states');
      setSelectedStates([]);
      setSelectedDate(undefined);
      setSelectedSlots({});
      setProviderAssignments({});
      setNotes('');
    }
  }, [open]);

  // Fetch last meeting dates for each state
  useEffect(() => {
    const fetchLastMeetings = async () => {
      const { data } = await supabase
        .from('supervision_meetings')
        .select('state_abbreviation, scheduled_date')
        .not('state_abbreviation', 'is', null)
        .order('scheduled_date', { ascending: false });
      
      if (data) {
        const lastByState: Record<string, Date | null> = {};
        data.forEach(meeting => {
          if (meeting.state_abbreviation && !lastByState[meeting.state_abbreviation]) {
            lastByState[meeting.state_abbreviation] = new Date(meeting.scheduled_date);
          }
        });
        setLastMeetings(lastByState);
      }
    };
    
    if (open) {
      fetchLastMeetings();
    }
  }, [open]);

  // Group agreements by state and calculate suggested dates
  const statesWithProviders = useMemo((): StateWithProviders[] => {
    const stateMap = new Map<string, StateWithProviders>();
    
    agreements.forEach(agreement => {
      const existing = stateMap.get(agreement.stateAbbreviation);
      const stateCompliance = stateComplianceData.find(
        c => c.state_abbreviation === agreement.stateAbbreviation
      );
      
      if (existing) {
        // Avoid duplicate providers
        if (!existing.providers.some(p => p.id === agreement.providerId)) {
          existing.providers.push({
            id: agreement.providerId,
            name: agreement.providerName,
            email: agreement.providerEmail,
            agreementId: agreement.id,
          });
        }
      } else {
        const lastMeeting = lastMeetings[agreement.stateAbbreviation] || null;
        const cadence = stateCompliance?.ca_meeting_cadence || null;
        
        stateMap.set(agreement.stateAbbreviation, {
          abbreviation: agreement.stateAbbreviation,
          name: agreement.stateName,
          meetingCadence: cadence,
          providers: [{
            id: agreement.providerId,
            name: agreement.providerName,
            email: agreement.providerEmail,
            agreementId: agreement.id,
          }],
          suggestedDate: calculateSuggestedDate(lastMeeting, cadence),
          lastMeetingDate: lastMeeting,
        });
      }
    });
    
    return Array.from(stateMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [agreements, stateComplianceData, lastMeetings]);

  // Calculate suggested date based on cadence
  function calculateSuggestedDate(lastMeeting: Date | null, cadence: string | null): Date | null {
    const baseDate = lastMeeting || new Date();
    
    if (!cadence) return null;
    
    const cadenceLower = cadence.toLowerCase();
    
    if (cadenceLower.includes('weekly')) {
      return addWeeks(baseDate, 1);
    } else if (cadenceLower.includes('biweekly') || cadenceLower.includes('bi-weekly')) {
      return addWeeks(baseDate, 2);
    } else if (cadenceLower.includes('monthly')) {
      return addMonths(baseDate, 1);
    } else if (cadenceLower.includes('quarterly') || cadenceLower.includes('quarter')) {
      return addMonths(baseDate, 3);
    } else if (cadenceLower.includes('annual') || cadenceLower.includes('yearly')) {
      return addMonths(baseDate, 12);
    }
    
    // Default: suggest 1 month from now if no matching cadence
    return addMonths(baseDate, 1);
  }

  // Get selected states data
  const selectedStatesData = useMemo(() => {
    return statesWithProviders.filter(s => selectedStates.includes(s.abbreviation));
  }, [statesWithProviders, selectedStates]);

  // Auto-suggest date when states are selected
  useEffect(() => {
    if (selectedStates.length > 0 && !selectedDate) {
      // Find the earliest suggested date among selected states
      const suggestedDates = selectedStatesData
        .map(s => s.suggestedDate)
        .filter((d): d is Date => d !== null);
      
      if (suggestedDates.length > 0) {
        const earliest = suggestedDates.reduce((a, b) => a < b ? a : b);
        setSelectedDate(earliest);
      } else {
        // Default to next week if no suggestions
        setSelectedDate(addWeeks(new Date(), 1));
      }
    }
  }, [selectedStates, selectedStatesData, selectedDate]);

  // Initialize provider assignments when states are selected
  useEffect(() => {
    if (selectedStates.length > 0) {
      const newAssignments: Record<string, Record<string, 'am' | 'pm'>> = {};
      const newSlots: Record<string, 'am' | 'pm' | 'both'> = {};
      
      selectedStatesData.forEach(state => {
        newSlots[state.abbreviation] = 'am';
        newAssignments[state.abbreviation] = {};
        state.providers.forEach(provider => {
          newAssignments[state.abbreviation][provider.id] = 'am';
        });
      });
      
      setSelectedSlots(prev => ({ ...newSlots, ...prev }));
      setProviderAssignments(prev => {
        const merged = { ...prev };
        Object.keys(newAssignments).forEach(state => {
          if (!merged[state]) {
            merged[state] = newAssignments[state];
          }
        });
        return merged;
      });
    }
  }, [selectedStates, selectedStatesData]);

  const handleStateToggle = (abbr: string) => {
    setSelectedStates(prev => 
      prev.includes(abbr) 
        ? prev.filter(s => s !== abbr)
        : [...prev, abbr]
    );
  };

  const handleSlotChange = (stateAbbr: string, slot: 'am' | 'pm' | 'both') => {
    setSelectedSlots(prev => ({ ...prev, [stateAbbr]: slot }));
    
    // Update all provider assignments for this state
    const state = selectedStatesData.find(s => s.abbreviation === stateAbbr);
    if (state) {
      const defaultSlot = slot === 'both' ? 'am' : slot;
      setProviderAssignments(prev => ({
        ...prev,
        [stateAbbr]: Object.fromEntries(
          state.providers.map(p => [p.id, prev[stateAbbr]?.[p.id] || defaultSlot])
        ),
      }));
    }
  };

  const handleProviderSlotChange = (stateAbbr: string, providerId: string, slot: 'am' | 'pm') => {
    setProviderAssignments(prev => ({
      ...prev,
      [stateAbbr]: {
        ...prev[stateAbbr],
        [providerId]: slot,
      },
    }));
  };

  const handleSubmit = async () => {
    if (!selectedDate || selectedStates.length === 0) return;
    
    setSubmitting(true);
    
    try {
      // Create meetings for each state (possibly 2 per state if using both slots)
      for (const stateData of selectedStatesData) {
        const slot = selectedSlots[stateData.abbreviation] || 'am';
        const slotsToCreate = slot === 'both' ? ['am', 'pm'] : [slot];
        
        for (const timeSlot of slotsToCreate) {
          // Create the meeting
          const time = timeSlot === 'am' ? AM_TIME : PM_TIME;
          const meetingDate = new Date(selectedDate);
          const [hours, minutes] = time.split(':').map(Number);
          meetingDate.setHours(hours, minutes, 0, 0);
          
          const { data: meeting, error: meetingError } = await supabase
            .from('supervision_meetings')
            .insert({
              scheduled_date: meetingDate.toISOString(),
              state_abbreviation: stateData.abbreviation,
              state_name: stateData.name,
              time_slot: timeSlot,
              meeting_type: 'collaborative_meeting',
              status: 'scheduled',
              notes: notes || null,
              // Link to first agreement for the state (for backward compatibility)
              agreement_id: stateData.providers[0]?.agreementId,
            })
            .select()
            .single();
          
          if (meetingError) throw meetingError;
          
          // Add attendees for this time slot
          const providersForSlot = stateData.providers.filter(p => {
            const assignment = providerAssignments[stateData.abbreviation]?.[p.id];
            return slot === 'both' ? assignment === timeSlot : true;
          });
          
          if (providersForSlot.length > 0 && meeting) {
            const attendeeInserts = providersForSlot.map(provider => ({
              meeting_id: meeting.id,
              provider_id: provider.id,
              provider_name: provider.name,
              provider_email: provider.email,
              attendance_status: 'invited',
            }));
            
            const { error: attendeeError } = await supabase
              .from('meeting_attendees')
              .insert(attendeeInserts);
            
            if (attendeeError) throw attendeeError;
          }
        }
      }
      
      toast({
        title: 'Meetings scheduled',
        description: `Successfully scheduled collaborative meetings for ${selectedStates.length} state(s).`,
      });
      
      onSuccess();
      onOpenChange(false);
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
      case 'states':
        return selectedStates.length > 0;
      case 'date':
        return selectedDate !== undefined;
      case 'providers':
        return true; // Provider assignments have defaults
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const goNext = () => {
    const steps: WizardStep[] = ['states', 'date', 'providers', 'review'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const goBack = () => {
    const steps: WizardStep[] = ['states', 'date', 'providers', 'review'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const formatCadence = (cadence: string | null): string => {
    if (!cadence) return 'Not set';
    return cadence
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Schedule Collaborative Meeting
          </DialogTitle>
          <DialogDescription>
            {step === 'states' && 'Select the states to include in this meeting.'}
            {step === 'date' && 'Choose the meeting date and time slots.'}
            {step === 'providers' && 'Assign providers to time slots.'}
            {step === 'review' && 'Review and confirm the meeting details.'}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicators */}
        <div className="flex items-center justify-center gap-2 py-4">
          {(['states', 'date', 'providers', 'review'] as WizardStep[]).map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  step === s
                    ? 'bg-primary text-primary-foreground'
                    : i < ['states', 'date', 'providers', 'review'].indexOf(step)
                    ? 'bg-success text-success-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {i < ['states', 'date', 'providers', 'review'].indexOf(step) ? (
                  <Check className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              {i < 3 && (
                <div
                  className={cn(
                    'w-12 h-0.5 mx-1',
                    i < ['states', 'date', 'providers', 'review'].indexOf(step)
                      ? 'bg-success'
                      : 'bg-muted'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <ScrollArea className="flex-1 pr-4">
          {/* Step 1: Select States */}
          {step === 'states' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <Info className="h-4 w-4 shrink-0" />
                <span>
                  Select all states that should have their collaborative meeting on the same day.
                  Each state will have its own meeting time slot.
                </span>
              </div>
              
              <div className="grid gap-3">
                {statesWithProviders.map(state => (
                  <Card
                    key={state.abbreviation}
                    className={cn(
                      'cursor-pointer transition-all hover:shadow-md',
                      selectedStates.includes(state.abbreviation)
                        ? 'border-primary ring-1 ring-primary'
                        : 'hover:border-muted-foreground/40'
                    )}
                    onClick={() => handleStateToggle(state.abbreviation)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selectedStates.includes(state.abbreviation)}
                            className="mt-1"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{state.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {state.abbreviation}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {state.providers.length} provider{state.providers.length !== 1 ? 's' : ''}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatCadence(state.meetingCadence)}
                              </span>
                            </div>
                            {state.lastMeetingDate && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Last meeting: {format(state.lastMeetingDate, 'MMM d, yyyy')}
                              </p>
                            )}
                          </div>
                        </div>
                        {state.suggestedDate && (
                          <Badge variant="secondary" className="text-xs whitespace-nowrap">
                            Suggested: {format(state.suggestedDate, 'MMM d')}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              
              {statesWithProviders.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No states with active agreements found.</p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Select Date and Time Slots */}
          {step === 'date' && (
            <div className="space-y-6">
              <div className="flex gap-6">
                <div className="flex-1">
                  <Label className="mb-2 block">Meeting Date</Label>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    className="rounded-md border"
                    disabled={(date) => date < new Date()}
                  />
                </div>
                
                <div className="flex-1 space-y-4">
                  <div>
                    <Label className="mb-2 block">Time Slots by State</Label>
                    <p className="text-sm text-muted-foreground mb-4">
                      AM slot: {AM_TIME} • PM slot: {PM_TIME}
                    </p>
                  </div>
                  
                  {selectedStatesData.map(state => (
                    <Card key={state.abbreviation}>
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{state.abbreviation}</span>
                          <span className="text-sm text-muted-foreground">
                            {state.providers.length} provider{state.providers.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant={selectedSlots[state.abbreviation] === 'am' ? 'default' : 'outline'}
                            size="sm"
                            className="flex-1"
                            onClick={() => handleSlotChange(state.abbreviation, 'am')}
                          >
                            <Sun className="h-3 w-3 mr-1" />
                            AM Only
                          </Button>
                          <Button
                            variant={selectedSlots[state.abbreviation] === 'pm' ? 'default' : 'outline'}
                            size="sm"
                            className="flex-1"
                            onClick={() => handleSlotChange(state.abbreviation, 'pm')}
                          >
                            <Moon className="h-3 w-3 mr-1" />
                            PM Only
                          </Button>
                          <Button
                            variant={selectedSlots[state.abbreviation] === 'both' ? 'default' : 'outline'}
                            size="sm"
                            className="flex-1"
                            onClick={() => handleSlotChange(state.abbreviation, 'both')}
                          >
                            Both
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Provider Assignments */}
          {step === 'providers' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <Info className="h-4 w-4 shrink-0" />
                <span>
                  Assign providers to AM or PM slots. By default, all providers are assigned to the selected slot.
                  You can move individual providers if needed.
                </span>
              </div>
              
              {selectedStatesData.map(state => {
                const slot = selectedSlots[state.abbreviation] || 'am';
                const showBothSlots = slot === 'both';
                
                return (
                  <Card key={state.abbreviation}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{state.name}</CardTitle>
                        <Badge variant="outline">
                          {slot === 'both' ? 'AM & PM' : slot.toUpperCase()}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {state.providers.map(provider => (
                        <div
                          key={provider.id}
                          className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30"
                        >
                          <div>
                            <p className="font-medium text-sm">{provider.name}</p>
                            <p className="text-xs text-muted-foreground">{provider.email}</p>
                          </div>
                          
                          {showBothSlots && (
                            <div className="flex gap-2">
                              <Button
                                variant={
                                  providerAssignments[state.abbreviation]?.[provider.id] === 'am'
                                    ? 'default'
                                    : 'outline'
                                }
                                size="sm"
                                onClick={() =>
                                  handleProviderSlotChange(state.abbreviation, provider.id, 'am')
                                }
                              >
                                <Sun className="h-3 w-3 mr-1" />
                                AM
                              </Button>
                              <Button
                                variant={
                                  providerAssignments[state.abbreviation]?.[provider.id] === 'pm'
                                    ? 'default'
                                    : 'outline'
                                }
                                size="sm"
                                onClick={() =>
                                  handleProviderSlotChange(state.abbreviation, provider.id, 'pm')
                                }
                              >
                                <Moon className="h-3 w-3 mr-1" />
                                PM
                              </Button>
                            </div>
                          )}
                          
                          {!showBothSlots && (
                            <Badge variant="secondary" className="text-xs">
                              {slot.toUpperCase()} ({slot === 'am' ? AM_TIME : PM_TIME})
                            </Badge>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Step 4: Review */}
          {step === 'review' && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    Meeting Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Date</span>
                      <p className="font-medium">
                        {selectedDate ? format(selectedDate, 'EEEE, MMMM d, yyyy') : 'Not selected'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">States</span>
                      <p className="font-medium">{selectedStates.length} state(s)</p>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  {selectedStatesData.map(state => {
                    const slot = selectedSlots[state.abbreviation] || 'am';
                    const amProviders = state.providers.filter(p => 
                      slot !== 'both' ? slot === 'am' : providerAssignments[state.abbreviation]?.[p.id] === 'am'
                    );
                    const pmProviders = state.providers.filter(p => 
                      slot !== 'both' ? slot === 'pm' : providerAssignments[state.abbreviation]?.[p.id] === 'pm'
                    );
                    
                    return (
                      <div key={state.abbreviation} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-primary" />
                          <span className="font-medium">{state.name}</span>
                        </div>
                        
                        {(slot === 'am' || slot === 'both') && amProviders.length > 0 && (
                          <div className="ml-6 p-3 bg-muted/30 rounded-lg">
                            <div className="flex items-center gap-2 text-sm mb-2">
                              <Sun className="h-3 w-3" />
                              <span className="font-medium">AM Slot ({AM_TIME})</span>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {amProviders.map(p => p.name).join(', ')}
                            </div>
                          </div>
                        )}
                        
                        {(slot === 'pm' || slot === 'both') && pmProviders.length > 0 && (
                          <div className="ml-6 p-3 bg-muted/30 rounded-lg">
                            <div className="flex items-center gap-2 text-sm mb-2">
                              <Moon className="h-3 w-3" />
                              <span className="font-medium">PM Slot ({PM_TIME})</span>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {pmProviders.map(p => p.name).join(', ')}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Meeting Notes (optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes about this meeting..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between pt-4 border-t">
          <div>
            {step !== 'states' && (
              <Button variant="ghost" onClick={goBack}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {step !== 'review' ? (
              <Button onClick={goNext} disabled={!canProceed()}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Scheduling...' : 'Schedule Meetings'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
