import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  FileText, 
  Users, 
  MapPin, 
  Shield,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { Tables } from '@/integrations/supabase/types';

type AgreementTask = Tables<'agreement_tasks'>;

interface ReadinessItem {
  id: string;
  label: string;
  status: 'completed' | 'pending' | 'blocked';
  description?: string;
  category: 'profile' | 'license' | 'agreement' | 'compliance';
  actionUrl?: string;
}

export function ReadinessScreen() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [readinessItems, setReadinessItems] = useState<ReadinessItem[]>([]);
  const [tasks, setTasks] = useState<AgreementTask[]>([]);
  const [licenses, setLicenses] = useState<Tables<'provider_licenses'>[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);

  useEffect(() => {
    if (!profile?.id) return;

    const fetchReadinessData = async () => {
      setLoading(true);
      try {
        // Fetch provider licenses
        const { data: licenseData } = await supabase
          .from('provider_licenses')
          .select('*')
          .eq('profile_id', profile.id);
        setLicenses(licenseData || []);

        // Fetch provider's agreement links
        const { data: providerAgreements } = await supabase
          .from('agreement_providers')
          .select(`
            *,
            agreement:agreement_id (
              id,
              state_name,
              state_abbreviation,
              workflow_status,
              physician_name
            )
          `)
          .eq('provider_id', profile.id);
        setAgreements(providerAgreements || []);

        // Fetch pending tasks for this provider
        const { data: taskData } = await supabase
          .from('agreement_tasks')
          .select('*')
          .eq('provider_id', profile.id)
          .neq('status', 'completed')
          .order('priority', { ascending: false });
        setTasks(taskData || []);

        // Build readiness items
        const items: ReadinessItem[] = [];

        // Profile completion - route to existing ProfileSettingsPage
        items.push({
          id: 'profile',
          label: 'Profile Information',
          status: profile.onboarding_completed ? 'completed' : 'pending',
          description: profile.onboarding_completed 
            ? 'Your profile has been completed'
            : 'Complete your profile information',
          category: 'profile',
          actionUrl: '/onboarding?mode=edit', // Route to onboarding in edit mode
        });

        // Bio - route to onboarding wizard for edit
        items.push({
          id: 'bio',
          label: 'Professional Bio',
          status: profile.bio ? 'completed' : 'pending',
          description: profile.bio 
            ? 'Bio has been added'
            : 'Add a professional bio for patient visibility',
          category: 'profile',
          actionUrl: '/onboarding?mode=edit', // Route to onboarding in edit mode
        });

        // Headshot - route to onboarding wizard for edit
        items.push({
          id: 'avatar',
          label: 'Profile Photo',
          status: profile.avatar_url ? 'completed' : 'pending',
          description: profile.avatar_url 
            ? 'Photo uploaded'
            : 'Upload a professional headshot',
          category: 'profile',
          actionUrl: '/onboarding?mode=edit', // Route to onboarding in edit mode
        });

        // Licenses by state
        const statesWithLicenses = new Set((licenseData || []).map(l => l.state_abbreviation));
        const selectedStates = profile.actively_licensed_states?.split(',').filter(Boolean) || [];
        
        selectedStates.forEach(state => {
          const license = licenseData?.find(l => l.state_abbreviation === state);
          const hasVerifiedLicense = license?.status === 'verified' || license?.status === 'active';
          const requiresCollab = license?.requires_collab_agreement;

          items.push({
            id: `license-${state}`,
            label: `${state} License`,
            status: hasVerifiedLicense ? 'completed' : 'pending',
            description: hasVerifiedLicense 
              ? 'License verified'
              : license?.status === 'reported' 
                ? 'Pending verification by Clinical Ops'
                : 'License information needed',
            category: 'license',
          });

          // If state requires collab, add agreement item
          if (requiresCollab) {
            const agreementLink = providerAgreements?.find(
              a => a.agreement?.state_abbreviation === state
            );
            const agreement = agreementLink?.agreement;
            const isActive = agreement?.workflow_status === 'active';
            const isBlocked = !agreement || agreement.workflow_status === 'draft';

            items.push({
              id: `agreement-${state}`,
              label: `${state} Collaborative Agreement`,
              status: isActive ? 'completed' : isBlocked ? 'blocked' : 'pending',
              description: isActive 
                ? `Active with ${agreement?.physician_name || 'Physician'}`
                : isBlocked 
                  ? 'Pending physician assignment'
                  : `In progress: ${agreement?.workflow_status}`,
              category: 'agreement',
            });
          }
        });

      } catch (error) {
        console.error('Error fetching readiness data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchReadinessData();
  }, [profile?.id, profile?.onboarding_completed, profile?.bio, profile?.avatar_url, profile?.actively_licensed_states]);

  const completedCount = readinessItems.filter(i => i.status === 'completed').length;
  const totalCount = readinessItems.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const blockedItems = readinessItems.filter(i => i.status === 'blocked');
  const pendingItems = readinessItems.filter(i => i.status === 'pending');
  const completedItems = readinessItems.filter(i => i.status === 'completed');

  const getStatusIcon = (status: ReadinessItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-warning" />;
      case 'blocked':
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
    }
  };

  const getCategoryIcon = (category: ReadinessItem['category']) => {
    switch (category) {
      case 'profile':
        return <FileText className="h-4 w-4" />;
      case 'license':
        return <MapPin className="h-4 w-4" />;
      case 'agreement':
        return <Users className="h-4 w-4" />;
      case 'compliance':
        return <Shield className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Activation Readiness</span>
            <Badge variant={progressPercent === 100 ? 'default' : 'secondary'}>
              {progressPercent}% Complete
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={progressPercent} className="h-3 mb-4" />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{completedCount} of {totalCount} items completed</span>
            {blockedItems.length > 0 && (
              <span className="text-destructive">
                {blockedItems.length} blocker{blockedItems.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Blockers Section */}
      {blockedItems.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Blockers ({blockedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {blockedItems.map(item => (
              <div key={item.id} className="flex items-start gap-3 p-3 bg-card rounded-lg border">
                {getStatusIcon(item.status)}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {getCategoryIcon(item.category)}
                    <span className="font-medium">{item.label}</span>
                  </div>
                  {item.description && (
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                  )}
                </div>
              </div>
            ))}
            <p className="text-sm text-muted-foreground">
              Clinical Operations is working on these items. No action needed from you.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pending Items */}
      {pendingItems.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-warning" />
              Pending ({pendingItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingItems.map(item => (
              <div key={item.id} className="flex items-start gap-3 p-3 bg-card rounded-lg border">
                {getStatusIcon(item.status)}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {getCategoryIcon(item.category)}
                    <span className="font-medium">{item.label}</span>
                  </div>
                  {item.description && (
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                  )}
                </div>
                {item.actionUrl && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={item.actionUrl}>
                      <ChevronRight className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Completed Items */}
      {completedItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="h-5 w-5 text-success" />
              Completed ({completedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {completedItems.map(item => (
              <div key={item.id} className="flex items-center gap-3 py-2">
                {getStatusIcon(item.status)}
                <div className="flex items-center gap-2 text-muted-foreground">
                  {getCategoryIcon(item.category)}
                  <span>{item.label}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pending Tasks from Clinical Ops */}
      {tasks.length > 0 && (
        <>
          <Separator />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Your Tasks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {tasks.slice(0, 5).map(task => (
                <div key={task.id} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <span className="font-medium">{task.title}</span>
                    {task.description && (
                      <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                    )}
                    {task.state_name && (
                      <Badge variant="outline" className="mt-2">{task.state_name}</Badge>
                    )}
                  </div>
                </div>
              ))}
              {tasks.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  +{tasks.length - 5} more tasks
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
