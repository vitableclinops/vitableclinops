import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  User,
  Users,
  FileText,
  Calendar,
  ChevronRight,
  ExternalLink,
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Clock,
  Stethoscope,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { Tables } from '@/integrations/supabase/types';

type DbAgreement = Tables<'collaborative_agreements'>;

interface PhysicianData {
  name: string;
  email: string;
  phone?: string;
  specialty?: string;
  agreements: Array<DbAgreement & { provider_count: number }>;
}

export default function PhysicianDetailPage() {
  const { physicianEmail } = useParams<{ physicianEmail: string }>();
  const navigate = useNavigate();
  const { profile, roles } = useAuth();
  
  const [physician, setPhysician] = useState<PhysicianData | null>(null);
  const [loading, setLoading] = useState(true);

  const userRole = roles.includes('admin') ? 'admin' : 
                   roles.includes('leadership') ? 'leadership' : 
                   roles.includes('physician') ? 'physician' : 'provider';

  useEffect(() => {
    if (!physicianEmail) return;

    const fetchPhysicianData = async () => {
      setLoading(true);
      const decodedEmail = decodeURIComponent(physicianEmail);
      
      // Fetch all agreements for this physician
      const { data: agreements } = await supabase
        .from('collaborative_agreements')
        .select('*')
        .eq('physician_email', decodedEmail);

      if (agreements && agreements.length > 0) {
        // Get provider counts for each agreement
        const agreementsWithCounts = await Promise.all(
          agreements.map(async (agreement) => {
            const { count } = await supabase
              .from('agreement_providers')
              .select('*', { count: 'exact', head: true })
              .eq('agreement_id', agreement.id)
              .eq('is_active', true);
            
            return {
              ...agreement,
              provider_count: count || 0,
            };
          })
        );

        setPhysician({
          name: agreements[0].physician_name,
          email: decodedEmail,
          agreements: agreementsWithCounts,
        });
      } else {
        setPhysician({
          name: 'Unknown Physician',
          email: decodedEmail,
          agreements: [],
        });
      }

      setLoading(false);
    };

    fetchPhysicianData();
  }, [physicianEmail]);

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  const activeAgreements = physician?.agreements.filter(a => a.workflow_status === 'active') || [];
  const totalProviders = physician?.agreements.reduce((sum, a) => sum + a.provider_count, 0) || 0;
  const uniqueStates = [...new Set(physician?.agreements.map(a => a.state_abbreviation) || [])];

  const breadcrumbs = [
    { label: 'Agreements', href: '/admin/agreements' },
    { label: `Dr. ${physician?.name || 'Physician'}` },
  ];

  if (!physicianEmail) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Physician not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      
      <main className="ml-16 lg:ml-64 transition-all duration-300">
        <div className="p-4 md:p-6 lg:p-8">
          {/* Breadcrumbs */}
          <Breadcrumbs items={breadcrumbs} className="mb-4" />

          {/* Back button */}
          <Link 
            to="/admin/agreements" 
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Agreements
          </Link>

          {loading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-8 w-64 bg-muted rounded" />
              <div className="h-32 bg-muted rounded" />
            </div>
          ) : physician ? (
            <>
              {/* Header */}
              <div className="flex items-start justify-between mb-8">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarFallback className="bg-primary/10 text-primary text-xl">
                      {getInitials(physician.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h1 className="text-3xl font-bold text-foreground">
                      Dr. {physician.name}
                    </h1>
                    <div className="flex items-center gap-4 mt-2 text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Mail className="h-4 w-4" />
                        {physician.email}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid gap-4 md:grid-cols-4 mb-8">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-foreground">{totalProviders}</div>
                    <p className="text-sm text-muted-foreground">Active Providers</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-foreground">{activeAgreements.length}</div>
                    <p className="text-sm text-muted-foreground">Active Agreements</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-foreground">{uniqueStates.length}</div>
                    <p className="text-sm text-muted-foreground">States</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-foreground">{physician.agreements.length}</div>
                    <p className="text-sm text-muted-foreground">Total Agreements</p>
                  </CardContent>
                </Card>
              </div>

              {/* Agreements list */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Collaborative Agreements
                  </CardTitle>
                  <CardDescription>
                    All agreements where Dr. {physician.name} is the supervising physician
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {physician.agreements.length > 0 ? (
                    <div className="space-y-3">
                      {physician.agreements.map(agreement => (
                        <Link
                          key={agreement.id}
                          to={`/admin/agreements/${agreement.id}`}
                          className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
                        >
                          <div className={cn(
                            'flex h-12 w-12 items-center justify-center rounded-lg text-lg font-bold',
                            agreement.workflow_status === 'active' 
                              ? 'bg-success/10 text-success' 
                              : 'bg-muted text-muted-foreground'
                          )}>
                            {agreement.state_abbreviation}
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                              {agreement.state_name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {agreement.provider_count} provider{agreement.provider_count !== 1 ? 's' : ''} • 
                              {agreement.meeting_cadence ? ` ${agreement.meeting_cadence.replace(/_/g, ' ')}` : ' No cadence set'}
                            </p>
                          </div>
                          <Badge 
                            variant={agreement.workflow_status === 'active' ? 'default' : 'secondary'}
                            className={agreement.workflow_status === 'active' ? 'bg-success/10 text-success' : ''}
                          >
                            {agreement.workflow_status}
                          </Badge>
                          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Stethoscope className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No agreements found for this physician</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Physician not found</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
