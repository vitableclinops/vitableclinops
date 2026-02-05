import { X, CheckCircle2, AlertTriangle, XCircle, Clock, FileText, Users, Shield, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { GridCell, GridProvider, GridState, CredentialingRequirement, CellStatus } from '@/types/grid';

interface CellDetailPanelProps {
  cell: GridCell;
  provider: GridProvider;
  state: GridState;
  onClose: () => void;
}

const statusConfig: Record<CellStatus, { icon: typeof CheckCircle2; label: string; className: string }> = {
  green: { icon: CheckCircle2, label: 'Complete', className: 'text-success' },
  yellow: { icon: AlertTriangle, label: 'Warning', className: 'text-warning' },
  red: { icon: XCircle, label: 'Blocked', className: 'text-destructive' },
  gray: { icon: Clock, label: 'Not Started', className: 'text-muted-foreground' },
};

const requirementIcons: Record<string, typeof FileText> = {
  licensure: FileText,
  collaborative_agreement: Users,
  fpa: Shield,
  prescriptive_authority: Stethoscope,
  compliance: CheckCircle2,
  supervision: Users,
};

function RequirementRow({ requirement }: { requirement: CredentialingRequirement }) {
  const config = statusConfig[requirement.status];
  const StatusIcon = config.icon;
  const TypeIcon = requirementIcons[requirement.type] || FileText;

  return (
    <div className={cn(
      'flex items-start gap-3 p-3 rounded-lg border',
      requirement.isBlocker ? 'bg-destructive/5 border-destructive/20' : 'bg-muted/30 border-muted'
    )}>
      <div className={cn('mt-0.5', config.className)}>
        <StatusIcon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">{requirement.label}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{requirement.statusLabel}</p>
        {requirement.detail && (
          <p className="text-xs text-muted-foreground mt-1">{requirement.detail}</p>
        )}
        {requirement.isBlocker && requirement.blockerReason && (
          <Badge variant="destructive" className="mt-2 text-xs">
            Blocker: {requirement.blockerReason}
          </Badge>
        )}
      </div>
    </div>
  );
}

export function CellDetailPanel({ cell, provider, state, onClose }: CellDetailPanelProps) {
  const licensureConfig = statusConfig[cell.licensure.status];
  const credentialingConfig = statusConfig[cell.credentialing.status];
  const LicensureIcon = licensureConfig.icon;
  const CredentialingIcon = credentialingConfig.icon;

  return (
    <Card className="w-96 max-h-[calc(100vh-8rem)] overflow-hidden flex flex-col shadow-lg">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="font-bold text-primary">{state.abbreviation}</span>
              <span className="text-muted-foreground">×</span>
              <span>{provider.name}</span>
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {state.name} • {provider.credentials || provider.providerType}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto space-y-4 pb-4">
        {/* Licensure Summary */}
        <div className="p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2">
            <LicensureIcon className={cn('h-5 w-5', licensureConfig.className)} />
            <span className="font-medium">Licensure Status</span>
            <Badge variant={cell.licensure.status === 'green' ? 'default' : 'secondary'} className="ml-auto">
              {licensureConfig.label}
            </Badge>
          </div>
          {cell.licensure.licenseNumber && (
            <p className="text-sm text-muted-foreground mt-2">
              License: {cell.licensure.licenseNumber}
            </p>
          )}
          {cell.licensure.expirationDate && (
            <p className="text-sm text-muted-foreground">
              Expires: {new Date(cell.licensure.expirationDate).toLocaleDateString()}
              {cell.licensure.daysUntilExpiry !== undefined && (
                <span className={cn(
                  'ml-2',
                  cell.licensure.daysUntilExpiry <= 30 && 'text-warning',
                  cell.licensure.daysUntilExpiry <= 0 && 'text-destructive'
                )}>
                  ({cell.licensure.daysUntilExpiry} days)
                </span>
              )}
            </p>
          )}
        </div>

        <Separator />

        {/* Credentialing Summary */}
        <div className="p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2">
            <CredentialingIcon className={cn('h-5 w-5', credentialingConfig.className)} />
            <span className="font-medium">Credentialing Readiness</span>
            <Badge variant={cell.credentialing.status === 'green' ? 'default' : 'secondary'} className="ml-auto">
              {cell.credentialing.isReady ? 'Ready' : credentialingConfig.label}
            </Badge>
          </div>
        </div>

        {/* Blockers */}
        {cell.credentialing.blockers.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-destructive flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Blockers ({cell.credentialing.blockers.length})
            </h4>
            <div className="space-y-2">
              {cell.credentialing.blockers.map((blocker) => (
                <RequirementRow key={blocker.id} requirement={blocker} />
              ))}
            </div>
          </div>
        )}

        {/* All Requirements */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            All Requirements ({cell.credentialing.requirements.length})
          </h4>
          <div className="space-y-2">
            {cell.credentialing.requirements
              .filter(r => !r.isBlocker)
              .map((requirement) => (
                <RequirementRow key={requirement.id} requirement={requirement} />
              ))}
          </div>
        </div>

        {/* State Context */}
        <div className="p-3 rounded-lg border border-muted bg-muted/20">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            State Requirements
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {state.requiresCollaborativeAgreement && (
              <Badge variant="outline" className="text-xs">CA Required</Badge>
            )}
            {state.hasFPA && (
              <Badge variant="outline" className="text-xs">FPA Available</Badge>
            )}
            {state.requiresPrescriptiveAuthority && (
              <Badge variant="outline" className="text-xs">Prescriptive Auth</Badge>
            )}
            {state.demandTag && (
              <Badge 
                variant="outline" 
                className={cn(
                  'text-xs capitalize',
                  state.demandTag === 'critical' && 'border-destructive text-destructive',
                  state.demandTag === 'at_risk' && 'border-warning text-warning'
                )}
              >
                {state.demandTag.replace('_', ' ')}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
