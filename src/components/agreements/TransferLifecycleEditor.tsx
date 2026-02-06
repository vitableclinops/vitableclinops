import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, addYears, differenceInDays } from 'date-fns';
import { 
  Calendar, 
  RefreshCw, 
  Users,
  FileText,
  CheckCircle2,
  Pencil,
  Save
} from 'lucide-react';

interface TransferLifecycleEditorProps {
  transferId: string;
  status: string;
  completedAt: string | null;
  effectiveDate: string | null;
  renewalDate: string | null;
  firstMeetingDate: string | null;
  meetingCadence: string | null;
  chartReviewFrequency: string | null;
  targetPhysicianName: string;
  affectedProviderCount: number;
  isAdmin: boolean;
  onUpdate: () => void;
}

export function TransferLifecycleEditor({
  transferId,
  status,
  completedAt,
  effectiveDate,
  renewalDate,
  firstMeetingDate,
  meetingCadence,
  chartReviewFrequency,
  targetPhysicianName,
  affectedProviderCount,
  isAdmin,
  onUpdate,
}: TransferLifecycleEditorProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Editable fields
  const [newRenewalDate, setNewRenewalDate] = useState(renewalDate || '');
  const [newFirstMeetingDate, setNewFirstMeetingDate] = useState(
    firstMeetingDate ? firstMeetingDate.split('T')[0] : ''
  );
  const [newMeetingCadence, setNewMeetingCadence] = useState(meetingCadence || '');
  const [newChartReviewFrequency, setNewChartReviewFrequency] = useState(chartReviewFrequency || '');

  const isCompleted = status === 'completed';
  
  // Calculate renewal date if not set
  const calculatedRenewalDate = renewalDate 
    ? new Date(renewalDate)
    : completedAt 
      ? addYears(new Date(completedAt), 1)
      : effectiveDate 
        ? addYears(new Date(effectiveDate), 1)
        : null;

  const daysUntilRenewal = calculatedRenewalDate 
    ? differenceInDays(calculatedRenewalDate, new Date())
    : null;

  const formatCadence = (cadence: string | null): string => {
    if (!cadence) return 'Not set';
    return cadence
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('agreement_transfers')
        .update({
          new_agreement_renewal_date: newRenewalDate || null,
          first_meeting_scheduled_date: newFirstMeetingDate 
            ? new Date(newFirstMeetingDate).toISOString() 
            : null,
          meeting_cadence: newMeetingCadence || null,
          chart_review_frequency: newChartReviewFrequency || null,
        })
        .eq('id', transferId);

      if (error) throw error;

      // Log the change
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('transfer_activity_log').insert({
        transfer_id: transferId,
        activity_type: 'lifecycle_updated',
        actor_id: user?.id,
        actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
        actor_role: 'admin',
        description: 'Updated lifecycle settings (renewal date, meeting cadence, etc.)',
      });

      toast({ title: 'Lifecycle settings updated' });
      setEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Error saving lifecycle:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isCompleted) {
    return null;
  }

  return (
    <Card className="bg-success/5 border-success/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Transfer Complete - Next Steps
          </CardTitle>
          {isAdmin && !editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Agreement Summary */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground">New Physician</p>
              <p className="font-medium">{targetPhysicianName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground">Providers</p>
              <p className="font-medium">{affectedProviderCount} provider(s)</p>
            </div>
          </div>
        </div>

        <Separator />

        {editing ? (
          // Edit mode
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Renewal Date</Label>
                <Input
                  type="date"
                  value={newRenewalDate}
                  onChange={(e) => setNewRenewalDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>First Meeting Date</Label>
                <Input
                  type="date"
                  value={newFirstMeetingDate}
                  onChange={(e) => setNewFirstMeetingDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Meeting Cadence</Label>
                <Select value={newMeetingCadence} onValueChange={setNewMeetingCadence}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select cadence" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="bi_monthly">Bi-Monthly</SelectItem>
                    <SelectItem value="annually">Annually</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Chart Review Frequency</Label>
                <Select value={newChartReviewFrequency} onValueChange={setNewChartReviewFrequency}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="bi_weekly">Bi-Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          // View mode
          <>
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Upcoming Dates
              </h4>
              
              <div className="grid gap-2 text-sm">
                {firstMeetingDate && (
                  <div className="flex items-center justify-between p-2 bg-background rounded-md">
                    <span className="text-muted-foreground">First Meeting</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {format(new Date(firstMeetingDate), 'MMM d, yyyy')}
                      </span>
                      <Badge variant="outline" className="text-xs">Scheduled</Badge>
                    </div>
                  </div>
                )}
                
                {calculatedRenewalDate && (
                  <div className="flex items-center justify-between p-2 bg-background rounded-md">
                    <span className="text-muted-foreground">Agreement Renewal</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {format(calculatedRenewalDate, 'MMM d, yyyy')}
                      </span>
                      {daysUntilRenewal !== null && (
                        <Badge 
                          variant={daysUntilRenewal < 30 ? 'destructive' : 'outline'}
                          className="text-xs"
                        >
                          {daysUntilRenewal < 0 
                            ? 'Overdue' 
                            : `${daysUntilRenewal} days`}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {!firstMeetingDate && !calculatedRenewalDate && (
                  <p className="text-muted-foreground text-sm italic">
                    No dates configured yet
                  </p>
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Ongoing Requirements
              </h4>
              
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between p-2 bg-background rounded-md">
                  <span className="text-muted-foreground">Meeting Cadence</span>
                  <Badge variant="secondary" className="text-xs">
                    {formatCadence(meetingCadence)}
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between p-2 bg-background rounded-md">
                  <span className="text-muted-foreground">Chart Reviews</span>
                  <Badge variant="secondary" className="text-xs">
                    {formatCadence(chartReviewFrequency)}
                  </Badge>
                </div>
              </div>
            </div>
          </>
        )}

        {completedAt && !editing && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            Completed on {format(new Date(completedAt), 'MMMM d, yyyy')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}