import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format, addYears, differenceInDays } from 'date-fns';
import { 
  Calendar, 
  RefreshCw, 
  Users,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface TransferLifecycleInfoProps {
  status: string;
  completedAt: string | null;
  effectiveDate: string | null;
  renewalDate: string | null;
  firstMeetingDate: string | null;
  meetingCadence: string | null;
  chartReviewFrequency: string | null;
  targetPhysicianName: string;
  affectedProviderCount: number;
}

export function TransferLifecycleInfo({
  status,
  completedAt,
  effectiveDate,
  renewalDate,
  firstMeetingDate,
  meetingCadence,
  chartReviewFrequency,
  targetPhysicianName,
  affectedProviderCount,
}: TransferLifecycleInfoProps) {
  const isCompleted = status === 'completed';
  
  // Calculate renewal date if not set (1 year from effective/completion date)
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

  if (!isCompleted) {
    return null;
  }

  return (
    <Card className="bg-success/5 border-success/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Transfer Complete - Next Steps
        </CardTitle>
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

        {/* Upcoming Dates */}
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
          </div>
        </div>

        <Separator />

        {/* Ongoing Requirements */}
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

        {completedAt && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            Completed on {format(new Date(completedAt), 'MMMM d, yyyy')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
