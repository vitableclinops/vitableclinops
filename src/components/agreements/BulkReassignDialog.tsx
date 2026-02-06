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
import { AlertTriangle, Users, ArrowRight, Calendar } from 'lucide-react';

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

export function BulkReassignDialog({
  open,
  onOpenChange,
  selectedAgreements,
  physicians,
  onSuccess,
}: BulkReassignDialogProps) {
  const { toast } = useToast();
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
            })
            .select()
            .single();

          if (transferError) throw transferError;

          // Create termination sub-workflow tasks
          const terminationTasks: Array<{
            transfer_id: string;
            agreement_id: string;
            title: string;
            description: string;
            category: 'termination' | 'chart_review' | 'document' | 'agreement_creation' | 'signature' | 'supervision_meeting' | 'renewal' | 'compliance' | 'custom';
            status: 'pending' | 'in_progress' | 'completed' | 'blocked';
            priority: string;
            assigned_role: string;
            is_auto_generated: boolean;
            auto_trigger: string;
            state_abbreviation: string;
            state_name: string;
          }> = [
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: `Notify ${firstProvider.physicianName} of termination`,
              description: `Send formal notification of agreement termination to Dr. ${firstProvider.physicianName}`,
              category: 'termination',
              status: 'pending',
              priority: 'high',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_termination',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: 'Notify affected providers of physician change',
              description: `Notify ${affectedProviders.length} provider(s) of the upcoming physician reassignment`,
              category: 'termination',
              status: 'pending',
              priority: 'high',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_termination',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: 'Complete final chart reviews with outgoing physician',
              description: 'Ensure all pending chart reviews are completed before transition',
              category: 'chart_review',
              status: 'pending',
              priority: 'medium',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_termination',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: 'Upload executed termination document',
              description: 'Obtain and upload the signed termination agreement for the old collaboration',
              category: 'document',
              status: 'pending',
              priority: 'high',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_termination',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
          ];

          // Create initiation sub-workflow tasks
          const initiationTasks: typeof terminationTasks = [
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: `Prepare new agreement with ${selectedPhysician.name}`,
              description: `Draft collaborative agreement document for new supervision relationship`,
              category: 'agreement_creation',
              status: 'pending',
              priority: 'high',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_initiation',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: 'Send new agreement for signatures',
              description: 'Route agreement to physician and all affected providers for signature',
              category: 'signature',
              status: 'pending',
              priority: 'high',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_initiation',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: 'Upload executed new agreement',
              description: 'Upload the fully signed new collaborative agreement document',
              category: 'document',
              status: 'pending',
              priority: 'high',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_initiation',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: 'Send confirmation to all parties',
              description: 'Send confirmation email to physician and providers that transfer is complete',
              category: 'custom',
              status: 'pending',
              priority: 'medium',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_initiation',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: 'Schedule first meeting with new physician',
              description: 'Set up initial collaborative meeting with the new supervising physician',
              category: 'supervision_meeting',
              status: 'pending',
              priority: 'medium',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_initiation',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
            {
              transfer_id: transfer.id,
              agreement_id: agreementId,
              title: 'Initialize chart review tracking',
              description: 'Set up chart review schedule and tracking for new collaboration',
              category: 'chart_review',
              status: 'pending',
              priority: 'medium',
              assigned_role: 'admin',
              is_auto_generated: true,
              auto_trigger: 'transfer_initiation',
              state_abbreviation: firstProvider.stateAbbreviation,
              state_name: firstProvider.stateName,
            },
          ];

          // Insert all tasks
          const { error: tasksError } = await supabase
            .from('agreement_tasks')
            .insert([...terminationTasks, ...initiationTasks]);

          if (tasksError) throw tasksError;

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
            },
          });

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
          ? `Created ${uniqueAgreementIds.length} transfer workflow(s) with checklist tasks.`
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
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
              <SelectContent>
                {physicians.map(physician => (
                  <SelectItem key={physician.id} value={physician.id}>
                    Dr. {physician.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Effective date */}
          <div className="space-y-2">
            <Label htmlFor="effectiveDate" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Effective Date (optional)
            </Label>
            <Input
              id="effectiveDate"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
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
                Generates separate termination and initiation tasks that must be completed manually. 
                Includes document uploads, notifications, and meeting scheduling steps.
              </p>
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