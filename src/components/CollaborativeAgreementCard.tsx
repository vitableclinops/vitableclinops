import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { 
  Calendar, 
  Users, 
  FileText, 
  ChevronRight,
  AlertTriangle,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CollaborativeAgreement } from '@/types';
import { states, collaboratingPhysicians, providers } from '@/data/mockData';

interface CollaborativeAgreementCardProps {
  agreement: CollaborativeAgreement;
  onClick?: () => void;
  className?: string;
}

const statusConfig = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  active: { label: 'Active', className: 'bg-success/10 text-success' },
  pending_renewal: { label: 'Pending Renewal', className: 'bg-warning/10 text-warning' },
  expired: { label: 'Expired', className: 'bg-destructive/10 text-destructive' },
  terminated: { label: 'Terminated', className: 'bg-destructive/10 text-destructive' },
};

export function CollaborativeAgreementCard({ agreement, onClick, className }: CollaborativeAgreementCardProps) {
  const state = states.find(s => s.id === agreement.stateId);
  const physician = collaboratingPhysicians.find(p => p.id === agreement.physicianId);
  const agreementProviders = providers.filter(p => agreement.providerIds.includes(p.id));
  const config = statusConfig[agreement.status];
  
  const daysUntilRenewal = Math.ceil(
    (new Date(agreement.nextRenewalDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  );
  const needsRenewal = daysUntilRenewal <= 30;

  return (
    <Card 
      className={cn(
        'card-interactive cursor-pointer group',
        needsRenewal && agreement.status === 'active' && 'border-warning/30',
        className
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold',
              agreement.status === 'active' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
            )}>
              {state?.abbreviation}
            </div>
            <div>
              <CardTitle className="text-base">{state?.name} Agreement</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge className={cn('text-xs', config.className)}>
                  {config.label}
                </Badge>
                {needsRenewal && agreement.status === 'active' && (
                  <Badge variant="outline" className="text-xs text-warning border-warning/30">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Renewal Due
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Physician */}
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {physician ? `${physician.firstName[0]}${physician.lastName[0]}` : '??'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              Dr. {physician?.firstName} {physician?.lastName}
            </p>
            <p className="text-xs text-muted-foreground">{physician?.specialty}</p>
          </div>
        </div>
        
        {/* Providers */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>{agreementProviders.length} provider{agreementProviders.length !== 1 ? 's' : ''} supervised</span>
        </div>
        
        {/* Dates */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            <span>Expires {new Date(agreement.endDate).toLocaleDateString()}</span>
          </div>
        </div>
        
        {/* Meeting cadence */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span className="capitalize">{agreement.meetingCadence} meetings</span>
          {agreement.chartReviewRequired && (
            <>
              <span>•</span>
              <FileText className="h-4 w-4" />
              <span>Chart review required</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
