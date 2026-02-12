import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Shield, 
  User, 
  Settings, 
  BarChart3,
  ArrowRight,
  MapPin,
  ClipboardList,
  Users
} from 'lucide-react';
import type { UserRole } from '@/types';
import { cn } from '@/lib/utils';
import { states, providers, taskTemplates } from '@/data/mockData';

const roles: { 
  id: UserRole; 
  title: string; 
  description: string; 
  icon: React.ComponentType<{ className?: string }>;
  features: string[];
}[] = [
  {
    id: 'provider',
    title: 'Provider',
    description: 'Complete licensure tasks, upload documentation, and track your progress.',
    icon: User,
    features: [
      'View your state licenses',
      'Complete assigned tasks',
      'Upload evidence and receipts',
      'Track reimbursements',
    ],
  },
  {
    id: 'admin',
    title: 'Clinical Operations',
    description: 'Manage provider tasks, review submissions, and oversee licensure operations.',
    icon: Settings,
    features: [
      'Assign tasks to providers',
      'Review and verify submissions',
      'Approve reimbursements',
      'Configure state requirements',
    ],
  },
];

const Index = () => {
  const navigate = useNavigate();
  const { roles: userRoles } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);

  // Auto-redirect if user already has roles assigned
  useEffect(() => {
    if (userRoles.length > 0) {
      if (userRoles.includes('admin')) {
        navigate('/admin', { replace: true });
      } else if (userRoles.includes('pod_lead')) {
        navigate('/admin', { replace: true });
      } else if (userRoles.includes('provider')) {
        navigate('/provider', { replace: true });
      } else if (userRoles.includes('physician')) {
        navigate('/physician', { replace: true });
      }
    }
  }, [userRoles, navigate]);

  const handleContinue = () => {
    if (selectedRole === 'provider') {
      navigate('/provider');
    } else if (selectedRole === 'admin') {
      navigate('/admin');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Shield className="h-10 w-10 text-accent" />
            <h1 className="text-3xl font-bold text-foreground">
              Provider Operations Hub
            </h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Internal licensure management for nurse practitioners across multiple U.S. states. 
            Select your role to continue.
          </p>
        </div>

        {/* Role cards */}
        <div className="grid gap-4 md:grid-cols-2 max-w-2xl mx-auto mb-8">
          {roles.map(role => {
            const Icon = role.icon;
            const isSelected = selectedRole === role.id;
            
            return (
              <Card 
                key={role.id}
                className={cn(
                  'cursor-pointer transition-all duration-200 hover:shadow-lg',
                  isSelected 
                    ? 'border-accent ring-2 ring-accent/20 shadow-lg' 
                    : 'hover:border-accent/50'
                )}
                onClick={() => setSelectedRole(role.id)}
              >
                <CardHeader className="pb-3">
                  <div className={cn(
                    'h-12 w-12 rounded-lg flex items-center justify-center mb-3 transition-colors',
                    isSelected ? 'bg-accent text-accent-foreground' : 'bg-primary/10 text-primary'
                  )}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-lg">{role.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {role.description}
                  </p>
                  <ul className="space-y-2">
                    {role.features.map((feature, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Continue button */}
        <div className="flex justify-center">
          <Button 
            size="lg"
            disabled={!selectedRole}
            onClick={handleContinue}
            className="min-w-[200px]"
          >
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>

        {/* Quick stats */}
        <div className="mt-16 grid grid-cols-3 gap-8 text-center">
          <div>
            <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
              <Users className="h-5 w-5" />
            </div>
            <p className="text-3xl font-bold text-foreground">{providers.length}</p>
            <p className="text-sm text-muted-foreground">Active Providers</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
              <MapPin className="h-5 w-5" />
            </div>
            <p className="text-3xl font-bold text-foreground">{states.length}</p>
            <p className="text-sm text-muted-foreground">States Configured</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
              <ClipboardList className="h-5 w-5" />
            </div>
            <p className="text-3xl font-bold text-foreground">{taskTemplates.length}</p>
            <p className="text-sm text-muted-foreground">Task Templates</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
