import { 
  Plus, 
  UserPlus, 
  FileCheck, 
  Calendar, 
  FileText,
  CheckCircle,
  Users,
  MapPin,
  ClipboardList,
  BookOpen
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: typeof Plus;
  color: string;
  action: () => void;
}

interface QuickActionsProps {
  role?: 'admin' | 'provider' | 'physician';
}

export function QuickActions({ role = 'admin' }: QuickActionsProps) {
  const navigate = useNavigate();
  
  const adminActions: QuickAction[] = [
    {
      id: 'assign-task',
      label: 'Assign License Task',
      description: 'Create a new licensure task for a provider',
      icon: Plus,
      color: 'bg-blue-500 hover:bg-blue-600',
      action: () => navigate('/providers'),
    },
    {
      id: 'verify-license',
      label: 'Verify Self-Reported',
      description: 'Review pending license verifications',
      icon: FileCheck,
      color: 'bg-green-500 hover:bg-green-600',
      action: () => navigate('/admin/intake'),
    },
    {
      id: 'request-collab',
      label: 'Request Collab Agreement',
      description: 'Initiate a new collaborative agreement',
      icon: Users,
      color: 'bg-purple-500 hover:bg-purple-600',
      action: () => navigate('/admin/agreements'),
    },
    {
      id: 'schedule-meeting',
      label: 'Schedule Supervision',
      description: 'Add a supervision meeting to calendar',
      icon: Calendar,
      color: 'bg-amber-500 hover:bg-amber-600',
      action: () => navigate('/admin/agreements'),
    },
    {
      id: 'state-config',
      label: 'Update State Rules',
      description: 'Modify state compliance requirements',
      icon: MapPin,
      color: 'bg-slate-500 hover:bg-slate-600',
      action: () => navigate('/admin/states'),
    },
    {
      id: 'knowledge-base',
      label: 'Knowledge Base',
      description: 'View SOPs and state guides',
      icon: BookOpen,
      color: 'bg-indigo-500 hover:bg-indigo-600',
      action: () => navigate('/admin/knowledge'),
    },
  ];
  
  const providerActions: QuickAction[] = [
    {
      id: 'view-tasks',
      label: 'View My Tasks',
      description: 'See pending licensure tasks',
      icon: ClipboardList,
      color: 'bg-blue-500 hover:bg-blue-600',
      action: () => navigate('/provider'),
    },
    {
      id: 'report-license',
      label: 'Report Existing License',
      description: 'Submit a license you already hold',
      icon: FileText,
      color: 'bg-green-500 hover:bg-green-600',
      action: () => navigate('/provider'),
    },
    {
      id: 'compliance',
      label: 'Complete Training',
      description: 'View compliance tasks',
      icon: CheckCircle,
      color: 'bg-purple-500 hover:bg-purple-600',
      action: () => navigate('/admin/compliance'),
    },
    {
      id: 'knowledge-base',
      label: 'View Guides',
      description: 'Access state guides and SOPs',
      icon: BookOpen,
      color: 'bg-indigo-500 hover:bg-indigo-600',
      action: () => navigate('/admin/knowledge'),
    },
  ];
  
  const physicianActions: QuickAction[] = [
    {
      id: 'view-providers',
      label: 'View Supervised NPs',
      description: 'See all providers you supervise',
      icon: Users,
      color: 'bg-blue-500 hover:bg-blue-600',
      action: () => navigate('/physician'),
    },
    {
      id: 'upcoming-meetings',
      label: 'Upcoming Meetings',
      description: 'View scheduled supervision meetings',
      icon: Calendar,
      color: 'bg-purple-500 hover:bg-purple-600',
      action: () => navigate('/physician'),
    },
    {
      id: 'chart-review',
      label: 'Chart Reviews',
      description: 'Access pending chart reviews',
      icon: FileCheck,
      color: 'bg-green-500 hover:bg-green-600',
      action: () => navigate('/physician'),
    },
  ];
  
  const actions = role === 'admin' 
    ? adminActions 
    : role === 'provider' 
      ? providerActions 
      : physicianActions;
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Quick Actions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {actions.map(action => {
            const Icon = action.icon;
            return (
              <Button
                key={action.id}
                variant="outline"
                className="h-auto p-4 flex flex-col items-center gap-2 text-center hover:bg-accent"
                onClick={action.action}
              >
                <div className={`p-2 rounded-lg text-white ${action.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">{action.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                    {action.description}
                  </p>
                </div>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
