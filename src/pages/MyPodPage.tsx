import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Users, MapPin, CheckCircle2, Clock, AlertTriangle, ChevronRight, Loader2, Mail } from 'lucide-react';

export default function MyPodPage() {
  const { profile, roles } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [podMembers, setPodMembers] = useState<any[]>([]);
  const [pod, setPod] = useState<any>(null);

  const isPodLead = roles.includes('pod_lead');
  const userName = profile?.full_name || 'User';
  const userEmail = profile?.email || '';
  const userRole = roles[0] || 'provider';

  useEffect(() => {
    if (!profile?.id || !isPodLead) return;

    const fetchPodData = async () => {
      setLoading(true);
      try {
        // Find the pod where this user is the lead
        const { data: podData } = await supabase
          .from('pods')
          .select('*')
          .eq('pod_lead_id', profile.id)
          .maybeSingle();

        setPod(podData);

        if (podData) {
          // Get members of this pod
          const { data: members } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url, activation_status, profession, onboarding_completed')
            .eq('pod_id', podData.id);

          setPodMembers(members || []);
        } else {
          // If no pod found by pod_lead_id, check if they have members via pod_lead_id on profiles
          const { data: members } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url, activation_status, profession, onboarding_completed')
            .eq('pod_lead_id', profile.id);

          setPodMembers(members || []);
        }
      } catch (error) {
        console.error('Error fetching pod data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPodData();
  }, [profile?.id, isPodLead]);

  const getStatusBadge = (member: any) => {
    if (!member.onboarding_completed) {
      return <Badge variant="secondary">Onboarding</Badge>;
    }
    switch (member.activation_status) {
      case 'active':
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200">Active</Badge>;
      case 'pending_agreements':
        return <Badge variant="outline" className="text-amber-600 border-amber-200">Pending Agreements</Badge>;
      case 'pending_review':
        return <Badge variant="outline" className="text-blue-600 border-blue-200">Pending Review</Badge>;
      default:
        return <Badge variant="secondary">{member.activation_status || 'Pending'}</Badge>;
    }
  };

  const getInitials = (name: string) => name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

  if (!isPodLead) {
    return (
      <div className="min-h-screen bg-background">
        <AppSidebar userRole={userRole as any} userName={userName} userEmail={userEmail} userAvatarUrl={profile?.avatar_url || undefined} />
        <main className="pl-64 transition-all duration-300">
          <div className="flex items-center justify-center min-h-screen">
            <p className="text-muted-foreground">You don't have Pod Lead access.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar userRole={userRole as any} userName={userName} userEmail={userEmail} userAvatarUrl={profile?.avatar_url || undefined} />
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Users className="h-7 w-7 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">My Pod</h1>
              {pod && <Badge variant="outline">{pod.name}</Badge>}
            </div>
            <p className="text-muted-foreground">
              Manage and monitor the providers in your pod.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : podMembers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Pod Members Yet</h3>
                <p className="text-muted-foreground">
                  No providers have been assigned to your pod. Contact an admin to assign providers.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Stats */}
              <div className="grid gap-4 md:grid-cols-3 mb-8">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-3xl font-bold">{podMembers.length}</div>
                    <p className="text-sm text-muted-foreground">Total Members</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-3xl font-bold text-emerald-600">
                      {podMembers.filter(m => m.activation_status === 'active').length}
                    </div>
                    <p className="text-sm text-muted-foreground">Active</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-3xl font-bold text-amber-600">
                      {podMembers.filter(m => m.activation_status !== 'active').length}
                    </div>
                    <p className="text-sm text-muted-foreground">Pending</p>
                  </CardContent>
                </Card>
              </div>

              {/* Member List */}
              <Card>
                <CardHeader>
                  <CardTitle>Pod Members</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {podMembers.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-4 bg-muted/50 rounded-lg hover:bg-muted/80 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={member.avatar_url} />
                            <AvatarFallback className="text-xs">{getInitials(member.full_name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{member.full_name}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Mail className="h-3.5 w-3.5" />
                              {member.email}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {member.profession && (
                            <Badge variant="secondary" className="text-xs capitalize">
                              {member.profession.replace(/_/g, ' ')}
                            </Badge>
                          )}
                          {getStatusBadge(member)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}