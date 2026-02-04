import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { 
  FileText, 
  CheckCircle2, 
  Clock, 
  XCircle,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SelfReportedLicense } from '@/types';
import { states, providers } from '@/data/mockData';

interface SelfReportedLicenseCardProps {
  license: SelfReportedLicense;
  onVerify?: (license: SelfReportedLicense) => void;
  onReject?: (license: SelfReportedLicense) => void;
  className?: string;
}

const statusConfig = {
  pending: { label: 'Pending', icon: Clock, className: 'bg-warning/10 text-warning' },
  verified: { label: 'Verified', icon: CheckCircle2, className: 'bg-success/10 text-success' },
  rejected: { label: 'Rejected', icon: XCircle, className: 'bg-destructive/10 text-destructive' },
};

export function SelfReportedLicenseCard({ 
  license, 
  onVerify, 
  onReject, 
  className 
}: SelfReportedLicenseCardProps) {
  const state = states.find(s => s.id === license.stateId);
  const provider = providers.find(p => p.id === license.providerId);
  const config = statusConfig[license.verificationStatus];
  const StatusIcon = config.icon;

  return (
    <Card className={cn('card-interactive', className)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Provider info */}
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary text-sm">
              {provider ? `${provider.firstName[0]}${provider.lastName[0]}` : '??'}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-foreground">
                {provider?.firstName} {provider?.lastName}
              </span>
              <Badge variant="secondary" className="text-xs">
                {state?.abbreviation}
              </Badge>
            </div>
            
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>License: {license.licenseNumber}</span>
            </div>
            
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span>Expires: {new Date(license.expirationDate).toLocaleDateString()}</span>
              <span>Submitted: {new Date(license.submittedAt).toLocaleDateString()}</span>
            </div>
          </div>
          
          {/* Status and actions */}
          <div className="flex flex-col items-end gap-2">
            <Badge className={cn('text-xs', config.className)}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
            
            {license.evidenceUrl && (
              <Button variant="ghost" size="sm" className="h-7 text-xs">
                <ExternalLink className="h-3 w-3 mr-1" />
                View
              </Button>
            )}
          </div>
        </div>
        
        {/* Action buttons for pending */}
        {license.verificationStatus === 'pending' && (onVerify || onReject) && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t">
            {onVerify && (
              <Button 
                size="sm" 
                className="flex-1"
                onClick={() => onVerify(license)}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Verify
              </Button>
            )}
            {onReject && (
              <Button 
                variant="outline" 
                size="sm" 
                className="flex-1"
                onClick={() => onReject(license)}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Reject
              </Button>
            )}
          </div>
        )}
        
        {/* Verification info */}
        {license.verificationStatus === 'verified' && license.verifiedAt && (
          <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
            Verified on {new Date(license.verifiedAt).toLocaleDateString()}
          </div>
        )}
        
        {license.verificationStatus === 'rejected' && license.rejectionReason && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs text-destructive">{license.rejectionReason}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
