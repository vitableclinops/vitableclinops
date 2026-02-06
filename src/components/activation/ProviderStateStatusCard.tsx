import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Power, 
  PowerOff, 
  History, 
  AlertTriangle,
  ShieldCheck,
  Calendar,
  User,
  ExternalLink
} from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  ActivationStatusBadge,
  ReadinessStatusBadge,
  MismatchBadge,
} from './ActivationStatusBadge';
import { ActivationActionDialog } from './ActivationActionDialog';
import { useActivationEvents, type ProviderStateStatus } from '@/hooks/useProviderStateStatus';
import { cn } from '@/lib/utils';

interface ProviderStateStatusCardProps {
  status: ProviderStateStatus;
  providerName: string;
  showProviderLink?: boolean;
  compact?: boolean;
}

export function ProviderStateStatusCard({
  status,
  providerName,
  showProviderLink = false,
  compact = false,
}: ProviderStateStatusCardProps) {
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<'activate' | 'deactivate' | 'request_activation' | 'request_deactivation'>('activate');
  const [showHistory, setShowHistory] = useState(false);

  const { data: events } = useActivationEvents(status.provider_id, status.state_abbreviation);

  const handleAction = (type: typeof actionType) => {
    setActionType(type);
    setActionDialogOpen(true);
  };

  const canActivate = status.ehr_activation_status === 'inactive' || 
    status.ehr_activation_status === 'deactivated' ||
    status.ehr_activation_status === 'activation_requested';
  
  const canDeactivate = status.ehr_activation_status === 'active' ||
    status.ehr_activation_status === 'deactivation_requested';

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-4 p-3 border rounded-lg">
        <div className="flex items-center gap-3">
          <Link 
            to={`/states/${status.state_abbreviation}`}
            className="font-medium hover:underline"
          >
            {status.state_abbreviation}
          </Link>
          <ReadinessStatusBadge 
            status={status.readiness_status} 
            reason={status.readiness_reason} 
          />
          <ActivationStatusBadge status={status.ehr_activation_status} />
          <MismatchBadge mismatchType={status.mismatch_type} />
        </div>
        <div className="flex items-center gap-2">
          {canActivate && (
            <Button size="sm" variant="outline" onClick={() => handleAction('activate')}>
              <Power className="h-3 w-3 mr-1" />
              Activate
            </Button>
          )}
          {canDeactivate && (
            <Button size="sm" variant="outline" onClick={() => handleAction('deactivate')}>
              <PowerOff className="h-3 w-3 mr-1" />
              Deactivate
            </Button>
          )}
        </div>
        <ActivationActionDialog
          open={actionDialogOpen}
          onOpenChange={setActionDialogOpen}
          providerId={status.provider_id}
          providerName={providerName}
          stateAbbreviation={status.state_abbreviation}
          stateName={status.state_abbreviation}
          currentStatus={status.ehr_activation_status}
          readinessStatus={status.readiness_status}
          readinessReason={status.readiness_reason}
          actionType={actionType}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link 
              to={`/states/${status.state_abbreviation}`}
              className="hover:underline"
            >
              {status.state_abbreviation}
            </Link>
            {showProviderLink && (
              <Link 
                to={`/directory?search=${encodeURIComponent(providerName)}`}
                className="text-sm font-normal text-muted-foreground hover:underline"
              >
                {providerName}
              </Link>
            )}
          </CardTitle>
          <MismatchBadge mismatchType={status.mismatch_type} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Readiness:</span>
            <ReadinessStatusBadge 
              status={status.readiness_status} 
              reason={status.readiness_reason} 
            />
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">EHR:</span>
            <ActivationStatusBadge status={status.ehr_activation_status} />
          </div>
        </div>

        {/* Readiness reason */}
        {status.readiness_reason && (
          <div className="flex items-start gap-2 p-2 bg-muted/50 rounded-md">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">{status.readiness_reason}</p>
          </div>
        )}

        {/* Override indicator */}
        {status.readiness_override && (
          <div className="flex items-center gap-2 p-2 bg-warning/10 border border-warning/30 rounded-md">
            <ShieldCheck className="h-4 w-4 text-warning" />
            <div className="text-sm">
              <span className="font-medium">Override Active</span>
              {status.override_reason && (
                <span className="text-muted-foreground"> — {status.override_reason}</span>
              )}
              {status.override_expires_at && (
                <span className="text-muted-foreground">
                  {' '}(expires {format(new Date(status.override_expires_at), 'MMM d, yyyy')})
                </span>
              )}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="grid gap-2 text-sm text-muted-foreground">
          {status.ehr_activated_at && (
            <div className="flex items-center gap-2">
              <Calendar className="h-3 w-3" />
              <span>Activated: {format(new Date(status.ehr_activated_at), 'MMM d, yyyy')}</span>
            </div>
          )}
          {status.ehr_deactivated_at && (
            <div className="flex items-center gap-2">
              <Calendar className="h-3 w-3" />
              <span>Deactivated: {format(new Date(status.ehr_deactivated_at), 'MMM d, yyyy')}</span>
            </div>
          )}
          {status.activation_notes && (
            <p className="italic">"{status.activation_notes}"</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2">
          {canActivate && (
            <Button size="sm" onClick={() => handleAction('activate')}>
              <Power className="h-4 w-4 mr-1" />
              Activate
            </Button>
          )}
          {canDeactivate && (
            <Button size="sm" variant="destructive" onClick={() => handleAction('deactivate')}>
              <PowerOff className="h-4 w-4 mr-1" />
              Deactivate
            </Button>
          )}
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-4 w-4 mr-1" />
            {showHistory ? 'Hide' : 'Show'} History
          </Button>
        </div>

        {/* History */}
        {showHistory && events && events.length > 0 && (
          <ScrollArea className="h-[200px] border rounded-md p-3">
            <div className="space-y-3">
              {events.map(event => (
                <div key={event.id} className="flex items-start gap-3 text-sm">
                  <div className="min-w-[100px] text-muted-foreground">
                    {format(new Date(event.created_at), 'MMM d, HH:mm')}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium capitalize">
                      {event.event_type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-muted-foreground flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {event.actor_name}
                    </p>
                    {event.notes && (
                      <p className="text-muted-foreground italic mt-1">"{event.notes}"</p>
                    )}
                    {event.evidence_link && (
                      <a 
                        href={event.evidence_link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary text-xs flex items-center gap-1 mt-1 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Evidence
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      <ActivationActionDialog
        open={actionDialogOpen}
        onOpenChange={setActionDialogOpen}
        providerId={status.provider_id}
        providerName={providerName}
        stateAbbreviation={status.state_abbreviation}
        stateName={status.state_abbreviation}
        currentStatus={status.ehr_activation_status}
        readinessStatus={status.readiness_status}
        readinessReason={status.readiness_reason}
        actionType={actionType}
      />
    </Card>
  );
}
