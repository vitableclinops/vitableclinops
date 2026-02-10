import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEmailNotifications } from '@/hooks/useEmailNotifications';
import { AlertTriangle, Users, ArrowRight, Calendar, FileText, Info } from 'lucide-react';

interface SelectedAgreement {
  id: string;
  providerId: string;
  providerName: string;
  providerEmail: string;
  physicianName: string;
  physicianEmail: string;
  stateAbbreviation: string;
  stateName: string;
  agreementId: string;
}

interface Physician {
  id: string;
  name: string;
  email: string;
}

interface BulkReassignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedAgreements: SelectedAgreement[];
  physicians: Physician[];
  onSuccess: () => void;
}

// Default task templates for transfer workflow
const getTerminationTasks = (
  sourcePhysicianName: string,
  affectedProviderCount: number
) => [
  {
    title: `Send termination agreement via BoxSign`,
    description: `Route termination agreement to ${sourcePhysicianName} for signature`,
    category: 'signature' as const,
    priority: 'high',
    is_required: true,
    sort_order: 1,
  },
  {
    title: 'Email NP + physician confirming termination initiated',
    description: `Send notification email to ${affectedProviderCount} provider(s) and Dr. ${sourcePhysicianName} about the pending termination`,
    category: 'custom' as const,
    priority: 'high',
    is_required: true,
    sort_order: 2,
  },
  {
    title: 'Upload executed termination agreement',
    description: 'Obtain and upload the fully signed termination document',
    category: 'document' as const,
    priority: 'high',
    is_required: true,
    sort_order: 3,
  },
  {
    title: 'Confirm termination effective date recorded',
    description: 'Verify the effective date of termination is captured in the system',
    category: 'compliance' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 4,
  },
  {
    title: 'Update meeting/cadence records as needed',
    description: 'Cancel or reschedule any pending meetings with the outgoing physician',
    category: 'supervision_meeting' as const,
    priority: 'medium',
    is_required: false,
    sort_order: 5,
  },
  {
    title: 'Update chart review linkage/tracking references',
    description: 'Ensure chart review records are updated to reflect the termination',
    category: 'chart_review' as const,
    priority: 'medium',
    is_required: false,
    sort_order: 6,
  },
];

const getInitiationTasks = (
  targetPhysicianName: string,
  affectedProviderCount: number
) => [
  {
    title: 'Initiate new collaborative agreement record',
    description: `Create new agreement record for ${affectedProviderCount} provider(s) with ${targetPhysicianName}`,
    category: 'agreement_creation' as const,
    priority: 'high',
    is_required: true,
    sort_order: 1,
  },
  {
    title: `Assign collaborating physician (${targetPhysicianName})`,
    description: 'Confirm physician assignment and update all provider records',
    category: 'custom' as const,
    priority: 'high',
    is_required: true,
    sort_order: 2,
  },
  {
    title: 'Send new agreement via BoxSign',
    description: 'Route new collaborative agreement to physician and all affected providers for signature',
    category: 'signature' as const,
    priority: 'high',
    is_required: true,
    sort_order: 3,
  },
  {
    title: 'Confirm NP + physician notification email sent',
    description: 'Verify all parties received email confirmation of the new agreement',
    category: 'custom' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 4,
  },
  {
    title: 'Upload executed new agreement',
    description: 'Upload the fully signed new collaborative agreement document',
    category: 'document' as const,
    priority: 'high',
    is_required: true,
    sort_order: 5,
  },
  {
    title: 'Schedule first collaboration meeting + record cadence',
    description: 'Set up initial collaborative meeting and establish meeting schedule',
    category: 'supervision_meeting' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 6,
  },
  {
    title: 'Link chart review calendar/tracker',
    description: 'Set up chart review schedule and store reference URL/tracker link',
    category: 'chart_review' as const,
    priority: 'medium',
    is_required: true,
    sort_order: 7,
  },
];

export function BulkReassignDialog({
  open,
  onOpenChange,
  selectedAgreements,
  physicians,
  onSuccess,
}: BulkReassignDialogProps) {
  const { toast } = useToast();
  const { notifyWorkflowInitiated } = useEmailNotifications();
  const [targetPhysician, setTargetPhysician] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [createTransferWorkflow, setCreateTransferWorkflow] = useState(true);
  const [loading, setLoading] = useState(false);

  // Group by state for display
  const groupedByState = selectedAgreements.reduce((acc, agreement) => {
    const key = agreement.stateAbbreviation;
    if (!acc[key]) {
      acc[key] = {
        stateName: agreement.stateName,
        stateAbbreviation: key,
        providers: [],
        agreementIds: new Set<string>(),
      };
    }
    acc[key].providers.push({
      id: agreement.providerId,
      name: agreement.providerName,
      email: agreement.providerEmail,
    });
    acc[key].agreementIds.add(agreement.agreementId);
    return acc;
  }, {} as Record<string, { stateName: string; stateAbbreviation: string; providers: Array<{ id: string; name: string; email: string }>; agreementIds: Set<string> }>);

  const selectedPhysician = physicians.find(p => p.id === targetPhysician);

  const handleReassign = async () => {
    if (!targetPhysician || !selectedPhysician) {
      toast({
        title: 'Error',
        description: 'Please select a target physician.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      // Get current user for audit
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      // Group agreements by unique agreement_id to process transfers
      const uniqueAgreementIds = [...new Set(selectedAgreements.map(a => a.agreementId))];

      for (const agreementId of uniqueAgreementIds) {
        const affectedProviders = selectedAgreements.filter(a => a.agreementId === agreementId);
        const firstProvider = affectedProviders[0];

        if (createTransferWorkflow) {
          // Create a transfer record that groups termination + initiation
          const { data: transfer, error: transferError } = await supabase
            .from('agreement_transfers')
            .insert({
              source_agreement_id: agreementId,
              source_physician_name: firstProvider.physicianName,
              source_physician_email: firstProvider.physicianEmail,
              target_physician_id: targetPhysician,
              target_physician_name: selectedPhysician.name,
              target_physician_email: selectedPhysician.email,
              affected_provider_ids: affectedProviders.map(p => p.providerId),
              affected_provider_count: affectedProviders.length,
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
              effective_date: effectiveDate || null,
              initiated_by: userId,
              notes,
              status: 'pending',
              readiness_status: effectiveDate ? 'ready_for_review' : 'not_ready',
              blocking_reasons: !effectiveDate 
                ? JSON.stringify([{ field: 'effective_date', label: 'No effective date set', severity: 'required' }])
                : '[]',
            })
            .select()
            .single();

          if (transferError) throw transferError;

          // Generate termination tasks from template
          const terminationTaskData = getTerminationTasks(
            firstProvider.physicianName,
            affectedProviders.length
          );

          const terminationTasks = terminationTaskData.map(task => ({
            transfer_id: transfer.id,
            agreement_id: agreementId,
            title: task.title,
            description: task.description,
            category: task.category,
            status: 'pending' as const,
            priority: task.priority,
            assigned_role: 'admin',
            is_auto_generated: true,
            is_required: task.is_required,
            sort_order: task.sort_order,
            auto_trigger: 'transfer_termination',
            state_abbreviation: firstProvider.stateAbbreviation,
            state_name: firstProvider.stateName,
          }));

          // Generate initiation tasks from template
          const initiationTaskData = getInitiationTasks(
            selectedPhysician.name,
            affectedProviders.length
          );

          const initiationTasks = initiationTaskData.map(task => ({
            transfer_id: transfer.id,
            agreement_id: agreementId,
            title: task.title,
            description: task.description,
            category: task.category,
            status: 'pending' as const,
            priority: task.priority,
            assigned_role: 'admin',
            is_auto_generated: true,
            is_required: task.is_required,
            sort_order: task.sort_order + 10, // Offset to keep initiation after termination
            auto_trigger: 'transfer_initiation',
            state_abbreviation: firstProvider.stateAbbreviation,
            state_name: firstProvider.stateName,
          }));

          // Insert all tasks
          const { error: tasksError } = await supabase
            .from('agreement_tasks')
            .insert([...terminationTasks, ...initiationTasks]);

          if (tasksError) throw tasksError;

          // Smart Intake: auto-generate tasks for missing required data
          const missingDataTasks = [];
          if (!effectiveDate) {
            missingDataTasks.push({
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: 'Set transfer effective date',
              description: 'An effective date is required to move this transfer to "Ready" status. Update the transfer effective dates section.',
              category: 'custom' as const,
              status: 'pending' as const,
              priority: 'high',
              assigned_role: 'admin',
              is_auto_generated: true,
              is_required: true,
              sort_order: 0,
              auto_trigger: 'smart_intake',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
              task_purpose: 'Required for workflow readiness — transfer cannot proceed without an effective date.',
              compliance_risk: 'Transfer may create a coverage gap if dates are not properly sequenced.',
            });
          }
          if (missingDataTasks.length > 0) {
            await supabase.from('agreement_tasks').insert(missingDataTasks);
          }

          // Log the transfer initiation activity
          await supabase.from('transfer_activity_log').insert({
            transfer_id: transfer.id,
            activity_type: 'status_changed',
            actor_id: userId,
            actor_name: user?.user_metadata?.full_name || user?.email || 'Admin',
            actor_role: 'admin',
            description: `Transfer workflow initiated from ${firstProvider.physicianName || 'Unassigned'} to ${selectedPhysician.name}`,
            metadata: {
              affected_providers: affectedProviders.map(p => p.providerName),
              effective_date: effectiveDate || null,
              termination_tasks_count: terminationTasks.length,
              initiation_tasks_count: initiationTasks.length,
            },
          });

          // Send email notifications for this transfer workflow
          const actorName = user?.user_metadata?.full_name || user?.email || 'Admin';
          
          // Notify all affected providers
          for (const provider of affectedProviders) {
            if (provider.providerEmail) {
              await notifyWorkflowInitiated(
                provider.providerEmail,
                provider.providerName,
                {
                  workflowType: 'Transfer',
                  providerName: provider.providerName,
                  stateName: provider.stateName,
                  physicianName: selectedPhysician.name,
                  initiatedBy: actorName,
                  notes: notes || undefined,
                  actionUrl: `${window.location.origin}/provider`,
                }
              );
            }
          }

          // Notify the new physician
          if (selectedPhysician.email) {
            await notifyWorkflowInitiated(
              selectedPhysician.email,
              selectedPhysician.name,
              {
                workflowType: 'Transfer',
                providerName: `${affectedProviders.length} provider(s)`,
                stateName: firstProvider.stateName,
                physicianName: selectedPhysician.name,
                initiatedBy: actorName,
                notes: notes || undefined,
                actionUrl: `${window.location.origin}/physician`,
              }
            );
          }

        } else {
          // Direct reassignment without transfer workflow - just update the agreement
          const { error: updateError } = await supabase
            .from('collaborative_agreements')
            .update({
              physician_id: targetPhysician,
              physician_name: selectedPhysician.name,
              physician_email: selectedPhysician.email,
            })
            .eq('id', agreementId);

          if (updateError) throw updateError;
        }

        // Write audit log
        await supabase.from('agreement_audit_log').insert({
          entity_type: 'collaborative_agreement',
          entity_id: agreementId,
          action: createTransferWorkflow ? 'transfer_initiated' : 'physician_reassigned',
          performed_by: userId,
          performed_by_role: 'admin',
          changes: {
            previous_physician: firstProvider.physicianName,
            new_physician: selectedPhysician.name,
            effective_date: effectiveDate || null,
            affected_providers: affectedProviders.map(p => p.providerName),
            notes,
          },
        });
      }

      toast({
        title: createTransferWorkflow ? 'Transfer workflows created' : 'Reassignment complete',
        description: createTransferWorkflow 
          ? `Created ${uniqueAgreementIds.length} transfer workflow(s) with ${getTerminationTasks('', 0).length + getInitiationTasks('', 0).length} checklist tasks each. Email notifications sent.`
          : `Updated ${uniqueAgreementIds.length} agreement(s) to ${selectedPhysician.name}.`,
      });

      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (error) {
      console.error('Error reassigning:', error);
      toast({
        title: 'Error',
        description: 'Failed to process reassignment. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setTargetPhysician('');
    setEffectiveDate('');
    setNotes('');
    setCreateTransferWorkflow(true);
  };

  // Calculate task counts for display
  const terminationTaskCount = getTerminationTasks('', 0).length;
  const initiationTaskCount = getInitiationTasks('', 0).length;
  const totalTaskCount = terminationTaskCount + initiationTaskCount;
  const requiredTaskCount = getTerminationTasks('', 0).filter(t => t.is_required).length +
    getInitiationTasks('', 0).filter(t => t.is_required).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent className="max-w-2xl overflow-visible">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Reassign Supervising Physician
          </DialogTitle>
          <DialogDescription>
            Transfer {selectedAgreements.length} provider agreement(s) to a new supervising physician.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Summary of affected agreements */}
          <div className="space-y-2">
            <Label>Affected Agreements</Label>
            <ScrollArea className="h-[120px] border rounded-md p-3">
              {Object.entries(groupedByState).map(([stateAbbr, data]) => (
                <div key={stateAbbr} className="flex items-center gap-2 py-1">
                  <Badge variant="outline">{stateAbbr}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {data.providers.length} provider(s): {data.providers.map(p => p.name).join(', ')}
                  </span>
                </div>
              ))}
            </ScrollArea>
          </div>

          {/* Current physician info */}
          <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Current Physician</p>
              <p className="font-medium">{selectedAgreements[0]?.physicianName || 'Pending assignment'}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">New Physician</p>
              <p className="font-medium">{selectedPhysician?.name || 'Select below'}</p>
            </div>
          </div>

          {/* Target physician selection */}
          <div className="space-y-2">
            <Label htmlFor="targetPhysician">New Supervising Physician *</Label>
            <Select value={targetPhysician} onValueChange={setTargetPhysician}>
              <SelectTrigger>
                <SelectValue placeholder="Select physician..." />
              </SelectTrigger>
              <SelectContent className="z-[200] max-h-60 overflow-y-auto bg-popover">
                {physicians.map(physician => (
                  <SelectItem key={physician.id} value={physician.id}>
                    Dr. {physician.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Effective date - REQUIRED for Smart Intake */}
          <div className="space-y-2">
            <Label htmlFor="effectiveDate" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Effective Date *
            </Label>
            <Input
              id="effectiveDate"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
            {!effectiveDate && (
              <p className="text-xs text-warning flex items-center gap-1">
                <Info className="h-3 w-3" />
                Transfer will be created in "Not Ready" state without an effective date. A task will be auto-generated.
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Reason for reassignment, special instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Transfer workflow option */}
          <div className="flex items-start gap-3 p-3 border rounded-lg">
            <Checkbox
              id="createTransferWorkflow"
              checked={createTransferWorkflow}
              onCheckedChange={(checked) => setCreateTransferWorkflow(checked === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="createTransferWorkflow" className="font-medium cursor-pointer">
                Create transfer workflow with checklist
              </Label>
              <p className="text-xs text-muted-foreground">
                Generates {totalTaskCount} tasks ({requiredTaskCount} required) across termination and initiation phases.
                Tasks include document uploads, notifications, signatures, and meeting scheduling.
              </p>
              {createTransferWorkflow && (
                <div className="flex gap-4 mt-2">
                  <div className="flex items-center gap-1 text-xs">
                    <FileText className="h-3 w-3" />
                    <span>{terminationTaskCount} termination tasks</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <FileText className="h-3 w-3" />
                    <span>{initiationTaskCount} initiation tasks</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {!createTransferWorkflow && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Direct reassignment will immediately update the physician on record without tracking 
                the termination/initiation process. Use this only for administrative corrections.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleReassign} disabled={loading || !targetPhysician}>
            {loading ? 'Processing...' : createTransferWorkflow ? 'Create Transfer Workflows' : 'Reassign Now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}