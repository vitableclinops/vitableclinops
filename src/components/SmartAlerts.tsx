import { 
  AlertTriangle, 
  Clock, 
  FileWarning, 
  Users, 
  Calendar,
  ChevronRight,
  Bell
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  collaborativeAgreements, 
  supervisionMeetings, 
  selfReportedLicenses,
  providers,
  states
} from '@/data/mockData';
import { differenceInDays, format, isAfter, isBefore, addDays } from 'date-fns';

interface Alert {
  id: string;
  type: 'critical' | 'warning' | 'info';
  category: 'agreement' | 'supervision' | 'license' | 'compliance';
  title: string;
  description: string;
  dueDate?: Date;
  actionLabel?: string;
  actionLink?: string;
  entityId?: string;
}

function generateAlerts(): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date();
  
  // Agreement renewal alerts
  collaborativeAgreements.forEach(agreement => {
    const daysUntilRenewal = differenceInDays(agreement.nextRenewalDate, now);
    
    if (daysUntilRenewal <= 0) {
      alerts.push({
        id: `agreement-expired-${agreement.id}`,
        type: 'critical',
        category: 'agreement',
        title: 'Collaborative Agreement Expired',
        description: `${states.find(s => s.id === agreement.stateId)?.name} agreement with ${agreement.physician?.firstName} ${agreement.physician?.lastName} has expired.`,
        dueDate: agreement.nextRenewalDate,
        actionLabel: 'Renew Now',
        entityId: agreement.id,
      });
    } else if (daysUntilRenewal <= 30) {
      alerts.push({
        id: `agreement-renewal-${agreement.id}`,
        type: daysUntilRenewal <= 7 ? 'critical' : 'warning',
        category: 'agreement',
        title: 'Agreement Renewal Due',
        description: `${states.find(s => s.id === agreement.stateId)?.name} agreement expires in ${daysUntilRenewal} days.`,
        dueDate: agreement.nextRenewalDate,
        actionLabel: 'Schedule Renewal',
        entityId: agreement.id,
      });
    }
  });
  
  // Supervision meeting alerts
  supervisionMeetings.forEach(meeting => {
    const daysUntilMeeting = differenceInDays(meeting.scheduledDate, now);
    
    if (meeting.status === 'scheduled') {
      if (daysUntilMeeting <= 0 && daysUntilMeeting >= -7) {
        alerts.push({
          id: `meeting-overdue-${meeting.id}`,
          type: 'critical',
          category: 'supervision',
          title: 'Supervision Meeting Overdue',
          description: `Meeting was scheduled for ${format(meeting.scheduledDate, 'MMM d')}. Mark as complete or reschedule.`,
          dueDate: meeting.scheduledDate,
          actionLabel: 'Update Status',
          entityId: meeting.id,
        });
      } else if (daysUntilMeeting > 0 && daysUntilMeeting <= 7) {
        alerts.push({
          id: `meeting-upcoming-${meeting.id}`,
          type: 'info',
          category: 'supervision',
          title: 'Upcoming Supervision Meeting',
          description: `${states.find(s => s.id === meeting.agreement?.stateId)?.name} meeting in ${daysUntilMeeting} days. Prepare chart reviews.`,
          dueDate: meeting.scheduledDate,
          actionLabel: 'Prepare Charts',
          entityId: meeting.id,
        });
      }
    }
  });
  
  // License verification alerts
  selfReportedLicenses.forEach(license => {
    if (license.verificationStatus === 'pending') {
      const daysSinceSubmission = differenceInDays(now, license.submittedAt);
      const state = states.find(s => s.id === license.stateId);
      const provider = providers.find(p => p.id === license.providerId);
      
      if (daysSinceSubmission >= 7) {
        alerts.push({
          id: `license-pending-${license.id}`,
          type: daysSinceSubmission >= 14 ? 'critical' : 'warning',
          category: 'license',
          title: 'License Verification Pending',
          description: `${provider?.firstName} ${provider?.lastName}'s ${state?.abbreviation} license has been pending verification for ${daysSinceSubmission} days.`,
          dueDate: license.submittedAt,
          actionLabel: 'Review Now',
          entityId: license.id,
        });
      }
    }
    
    // Expiring license alerts
    const daysUntilExpiration = differenceInDays(license.expirationDate, now);
    if (daysUntilExpiration <= 60 && daysUntilExpiration > 0) {
      const state = states.find(s => s.id === license.stateId);
      const provider = providers.find(p => p.id === license.providerId);
      
      alerts.push({
        id: `license-expiring-${license.id}`,
        type: daysUntilExpiration <= 30 ? 'critical' : 'warning',
        category: 'license',
        title: 'License Expiring Soon',
        description: `${provider?.firstName} ${provider?.lastName}'s ${state?.abbreviation} license expires in ${daysUntilExpiration} days.`,
        dueDate: license.expirationDate,
        actionLabel: 'Initiate Renewal',
        entityId: license.id,
      });
    }
  });
  
  // Compliance alerts
  providers.forEach(provider => {
    if (provider.complianceStatus && !provider.complianceStatus.isCompliant) {
      if (provider.complianceStatus.overdueTasks > 0) {
        alerts.push({
          id: `compliance-overdue-${provider.id}`,
          type: 'critical',
          category: 'compliance',
          title: 'Overdue Compliance Tasks',
          description: `${provider.firstName} ${provider.lastName} has ${provider.complianceStatus.overdueTasks} overdue compliance task(s).`,
          dueDate: provider.complianceStatus.nextDueDate,
          actionLabel: 'View Tasks',
          entityId: provider.id,
        });
      }
    }
  });
  
  // Sort by type (critical first) then by due date
  return alerts.sort((a, b) => {
    const typeOrder = { critical: 0, warning: 1, info: 2 };
    if (typeOrder[a.type] !== typeOrder[b.type]) {
      return typeOrder[a.type] - typeOrder[b.type];
    }
    if (a.dueDate && b.dueDate) {
      return a.dueDate.getTime() - b.dueDate.getTime();
    }
    return 0;
  });
}

const categoryConfig = {
  agreement: { icon: Users, label: 'Agreement' },
  supervision: { icon: Calendar, label: 'Supervision' },
  license: { icon: FileWarning, label: 'License' },
  compliance: { icon: AlertTriangle, label: 'Compliance' },
};

const typeConfig = {
  critical: { 
    color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 border-red-200 dark:border-red-800',
    badge: 'bg-red-500 text-white'
  },
  warning: { 
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    badge: 'bg-amber-500 text-white'
  },
  info: { 
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    badge: 'bg-blue-500 text-white'
  },
};

interface SmartAlertsProps {
  maxAlerts?: number;
  showHeader?: boolean;
  compact?: boolean;
}

export function SmartAlerts({ maxAlerts = 5, showHeader = true, compact = false }: SmartAlertsProps) {
  const alerts = generateAlerts();
  const displayAlerts = maxAlerts ? alerts.slice(0, maxAlerts) : alerts;
  const criticalCount = alerts.filter(a => a.type === 'critical').length;
  const warningCount = alerts.filter(a => a.type === 'warning').length;
  
  if (alerts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Bell className="h-12 w-12 mx-auto text-green-500 mb-3" />
          <h3 className="font-semibold text-green-700 dark:text-green-400">All Clear</h3>
          <p className="text-sm text-muted-foreground mt-1">No alerts requiring attention</p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      {showHeader && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Smart Alerts
            </CardTitle>
            <div className="flex gap-2">
              {criticalCount > 0 && (
                <Badge className={typeConfig.critical.badge}>
                  {criticalCount} Critical
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge className={typeConfig.warning.badge}>
                  {warningCount} Warning
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
      )}
      <CardContent className={showHeader ? '' : 'pt-6'}>
        <ScrollArea className={compact ? 'h-auto' : 'h-[300px]'}>
          <div className="space-y-3">
            {displayAlerts.map(alert => {
              const categoryIcon = categoryConfig[alert.category];
              const Icon = categoryIcon.icon;
              const typeStyle = typeConfig[alert.type];
              
              return (
                <div 
                  key={alert.id}
                  className={`p-3 rounded-lg border ${typeStyle.color} transition-all hover:shadow-sm`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{alert.title}</span>
                        <Badge variant="outline" className="text-xs">
                          {categoryIcon.label}
                        </Badge>
                      </div>
                      <p className="text-sm opacity-90">{alert.description}</p>
                      {alert.dueDate && (
                        <p className="text-xs mt-1 opacity-75 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(alert.dueDate, 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                    {alert.actionLabel && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="shrink-0"
                      >
                        {alert.actionLabel}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        
        {alerts.length > maxAlerts && (
          <div className="mt-4 pt-4 border-t">
            <Button variant="outline" className="w-full">
              View All {alerts.length} Alerts
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
