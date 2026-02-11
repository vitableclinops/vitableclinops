import { useState, useEffect } from 'react';
import { InitiateLicensureDialog } from '@/components/licensure/InitiateLicensureDialog';
import { useAllLicensureApplications } from '@/hooks/useLicensureApplications';
import { useParams, Link } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { RelatedLinksCard } from '@/components/navigation/RelatedLinksCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { useStateCompliance } from '@/hooks/useStateCompliance';
import { supabase } from '@/integrations/supabase/client';
import {
  MapPin,
  Users,
  FileText,
  Shield,
  ChevronRight,
  ExternalLink,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pill,
  Edit,
  ArrowLeft,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgreementWithProviders {
  id: string;
  physician_name: string;
  physician_email: string;
  workflow_status: string;
  meeting_cadence: string | null;
  start_date: string | null;
  providers: {
    id: string;
    provider_name: string;
    provider_email: string;
    is_active: boolean;
  }[];
}

interface ProviderLicense {
  id: string;
  profile_id: string;
  state_abbreviation: string;
  license_number: string | null;
  license_type: string | null;
  status: string | null;
  expiration_date: string | null;
  provider_name?: string;
  provider_email?: string;
}

export default function StateDetailPage() {
  const { stateAbbr } = useParams<{ stateAbbr: string }>();
  const { profile, roles } = useAuth();
  const { allData: complianceData, getStateCompliance, loading: complianceLoading } = useStateCompliance();
  
  const [agreements, setAgreements] = useState<AgreementWithProviders[]>([]);
  const stateCompliance = stateAbbr ? getStateCompliance(stateAbbr) : null;
  const [licenses, setLicenses] = useState<ProviderLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLicensureDialog, setShowLicensureDialog] = useState(false);
  const { applications: licensureApps, refetch: refetchLicensure } = useAllLicensureApplications(stateAbbr || undefined);

  

  const userRole = roles.includes('admin') ? 'admin' : 
                   roles.includes('physician') ? 'physician' : 'provider';

  useEffect(() => {
    if (!stateAbbr) return;

    const fetchData = async () => {
      setLoading(true);
      
      // Fetch agreements for this state
      const { data: agreementsData } = await supabase
        .from('collaborative_agreements')
        .select('id, physician_name, physician_email, workflow_status, meeting_cadence, start_date')
        .eq('state_abbreviation', stateAbbr);

      if (agreementsData) {
        // Fetch providers for each agreement
        const agreementsWithProviders = await Promise.all(
          agreementsData.map(async (agreement) => {
            const { data: providers } = await supabase
              .from('agreement_providers')
              .select('id, provider_name, provider_email, is_active')
              .eq('agreement_id', agreement.id);
            
            return {
              ...agreement,
              providers: providers || [],
            };
          })
        );
        setAgreements(agreementsWithProviders);
      }

      // Fetch licenses for this state with provider info
      const { data: licensesData } = await supabase
        .from('provider_licenses')
        .select(`
          id,
          profile_id,
          state_abbreviation,
          license_number,
          license_type,
          status,
          expiration_date,
          provider_email
        `)
        .eq('state_abbreviation', stateAbbr);

      if (licensesData) {
        // Get provider names
        const profileIds = [...new Set(licensesData.map(l => l.profile_id).filter(Boolean))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', profileIds);

        const licensesWithNames = licensesData.map(license => ({
          ...license,
          provider_name: profiles?.find(p => p.id === license.profile_id)?.full_name || 'Unknown',
          provider_email: profiles?.find(p => p.id === license.profile_id)?.email || license.provider_email,
        }));
        setLicenses(licensesWithNames);
      }

      setLoading(false);
    };

    fetchData();
  }, [stateAbbr]);

  const activeAgreements = agreements.filter(a => a.workflow_status === 'active');
  const activeProviders = agreements.flatMap(a => a.providers.filter(p => p.is_active));
  const uniqueProviders = [...new Map(activeProviders.map(p => [p.provider_email, p])).values()];
  const uniquePhysicians = [...new Map(agreements.map(a => [a.physician_email, a])).values()];

  const breadcrumbs = [
    { label: 'States', href: '/admin/states' },
    { label: stateCompliance?.state_name || stateAbbr || 'State' },
  ];

  if (!stateAbbr) {
    return <div>State not found</div>;
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
          <Link to="/admin/states" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back to States
          </Link>

          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className={cn(
                'flex h-16 w-16 items-center justify-center rounded-xl text-2xl font-bold',
                stateCompliance?.fpa_status === 'FPA' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
              )}>
                {stateAbbr}
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">
                  {stateCompliance?.state_name || stateAbbr}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  {stateCompliance?.fpa_status === 'FPA' ? (
                    <Badge className="bg-success/10 text-success border-0">
                      <Shield className="h-3 w-3 mr-1" />
                      Full Practice Authority
                    </Badge>
                  ) : stateCompliance?.ca_required ? (
                    <Badge variant="secondary">
                      <Users className="h-3 w-3 mr-1" />
                      Collaborative Agreement Required
                    </Badge>
                  ) : (
                    <Badge variant="outline">Supervision Varies</Badge>
                  )}
                  {stateCompliance?.nlc && (
                    <Badge variant="outline">NLC Member</Badge>
                  )}
                </div>
              </div>
            </div>
            
            {roles.includes('admin') && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowLicensureDialog(true)}>
                  <FileText className="h-4 w-4 mr-2" />
                  Initiate Licensure
                </Button>
                <Button variant="outline">
                  <Edit className="h-4 w-4 mr-2" />
                  Edit State
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Stats */}
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-foreground">{uniqueProviders.length}</div>
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
                    <div className="text-2xl font-bold text-foreground">{uniquePhysicians.length}</div>
                    <p className="text-sm text-muted-foreground">Physicians</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-foreground">{licenses.length}</div>
                    <p className="text-sm text-muted-foreground">Licenses</p>
                  </CardContent>
                </Card>
              </div>

              <Tabs defaultValue="compliance">
                <TabsList>
                  <TabsTrigger value="compliance">Compliance Requirements</TabsTrigger>
                  <TabsTrigger value="instructions">Licensure Instructions</TabsTrigger>
                  <TabsTrigger value="agreements">Agreements ({activeAgreements.length})</TabsTrigger>
                  <TabsTrigger value="providers">Providers ({uniqueProviders.length})</TabsTrigger>
                  <TabsTrigger value="licenses">Licenses ({licenses.length})</TabsTrigger>
                  <TabsTrigger value="licensure">Licensure Pipeline ({licensureApps.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="compliance" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>State Compliance Requirements</CardTitle>
                      <CardDescription>
                        Regulatory requirements for practicing in {stateCompliance?.state_name || stateAbbr}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* FPA Status */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Practice Authority</p>
                          <p className="font-medium">{stateCompliance?.fpa_status || 'Not specified'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">CA Required</p>
                          <p className="font-medium">{stateCompliance?.ca_required ? 'Yes' : 'No'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Meeting Cadence</p>
                          <p className="font-medium">{stateCompliance?.ca_meeting_cadence || 'Not specified'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">NP:MD Ratio</p>
                          <p className="font-medium">{stateCompliance?.np_md_ratio || 'Not specified'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Rx Authority Required</p>
                          <p className="font-medium">{stateCompliance?.rxr_required ? 'Yes' : 'No'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">NLC State</p>
                          <p className="font-medium">{stateCompliance?.nlc ? 'Yes' : 'No'}</p>
                        </div>
                      </div>

                      <Separator />

                      {/* Steps to confirm eligibility */}
                      {stateCompliance?.steps_to_confirm_eligibility && (
                        <>
                          <Separator />
                          <div>
                            <h4 className="font-medium mb-2">Steps to Confirm Eligibility</h4>
                            <div className="bg-muted/50 p-4 rounded-lg text-sm whitespace-pre-wrap">
                              {stateCompliance.steps_to_confirm_eligibility}
                            </div>
                          </div>
                        </>
                      )}

                      {stateCompliance?.knowledge_base_url && (
                        <Button variant="outline" asChild>
                          <a href={stateCompliance.knowledge_base_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2" />
                            View State Nursing Board
                          </a>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="instructions" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <BookOpen className="h-5 w-5" />
                        Step-by-Step Licensure Instructions
                      </CardTitle>
                      <CardDescription>
                        Provider-facing instructions for {stateCompliance?.state_name || stateAbbr} licensure
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {stateCompliance?.knowledge_base_url ? (
                        <div className="space-y-4">
                          <div className="bg-muted/50 p-4 rounded-lg border border-muted">
                            <p className="text-sm text-muted-foreground mb-3">
                              Detailed step-by-step instructions and resources for applying for a license in {stateCompliance?.state_name}:
                            </p>
                            <Button variant="outline" asChild>
                              <a href={stateCompliance.knowledge_base_url} target="_blank" rel="noopener noreferrer">
                                <BookOpen className="h-4 w-4 mr-2" />
                                View Full Licensure Guide
                              </a>
                            </Button>
                          </div>
                          
                          <div className="bg-secondary/10 border border-secondary/30 p-4 rounded-lg">
                            <p className="text-sm text-secondary">
                              <strong>Note:</strong> Providers can access detailed instructions when they begin their licensure application. Admins can also link to this resource when initiating a licensure task.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-center py-8">
                          No licensure instructions available. Please configure knowledge base resources for this state.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="agreements" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Active Collaborative Agreements</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {activeAgreements.length > 0 ? (
                        <div className="space-y-3">
                          {activeAgreements.map(agreement => (
                            <Link
                              key={agreement.id}
                              to={`/admin/agreements/${agreement.id}`}
                              className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
                            >
                              <div className="flex-1">
                                <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                                  Dr. {agreement.physician_name}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {agreement.providers.filter(p => p.is_active).length} active providers • {agreement.meeting_cadence || 'No cadence set'}
                                </p>
                              </div>
                              <Badge variant="secondary" className="bg-success/10 text-success">Active</Badge>
                              <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-center py-8">
                          No active agreements for this state
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="providers" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Providers in {stateAbbr}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {uniqueProviders.length > 0 ? (
                        <div className="space-y-3">
                          {uniqueProviders.map(provider => (
                            <Link
                              key={provider.id}
                              to={`/directory?search=${encodeURIComponent(provider.provider_email)}`}
                              className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
                            >
                              <Avatar className="h-10 w-10">
                                <AvatarFallback className="bg-primary/10 text-primary">
                                  {provider.provider_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1">
                                <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                                  {provider.provider_name}
                                </p>
                                <p className="text-sm text-muted-foreground">{provider.provider_email}</p>
                              </div>
                              <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-center py-8">
                          No providers found for this state
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="licenses" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Licenses in {stateAbbr}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {licenses.length > 0 ? (
                        <div className="space-y-3">
                          {licenses.map(license => (
                            <div
                              key={license.id}
                              className="flex items-center gap-4 p-4 rounded-lg border"
                            >
                              <div className="flex-1">
                                <p className="font-medium text-foreground">
                                  {license.provider_name}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {license.license_type || 'License'} • {license.license_number || 'No number'}
                                </p>
                              </div>
                              <Badge 
                                variant={license.status === 'active' ? 'default' : 'secondary'}
                                className={license.status === 'active' ? 'bg-success/10 text-success' : ''}
                              >
                                {license.status || 'Unknown'}
                              </Badge>
                              {license.expiration_date && (
                                <span className="text-xs text-muted-foreground">
                                  Exp: {new Date(license.expiration_date).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-center py-8">
                          No licenses found for this state
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="licensure" className="mt-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle>Licensure Applications</CardTitle>
                      <Button size="sm" onClick={() => setShowLicensureDialog(true)}>
                        <FileText className="h-4 w-4 mr-2" />
                        New Application
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {licensureApps.length > 0 ? (
                        <div className="space-y-3">
                          {licensureApps.map(app => (
                            <Link
                              key={app.id}
                              to={`/licensure/${app.id}`}
                              className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
                            >
                              <div className="flex-1">
                                <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                                  {app.provider_name}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {app.designation_label} • {app.status.replace(/_/g, ' ')}
                                </p>
                              </div>
                              <Badge variant="secondary" className={
                                app.status === 'approved' ? 'bg-success/10 text-success' :
                                app.status === 'in_progress' ? 'bg-warning/10 text-warning' :
                                app.status === 'submitted' ? 'bg-primary/10 text-primary' : ''
                              }>
                                {app.status.replace(/_/g, ' ')}
                              </Badge>
                              <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-center py-8">
                          No licensure applications for this state yet.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>

            {/* Sidebar - Related Links */}
            <div className="space-y-6">
              <RelatedLinksCard
                title="Quick Actions"
                links={[
                  {
                    label: 'View Provider Grid',
                    href: `/grid?state=${stateAbbr}`,
                    icon: Users,
                    description: 'Provider-state credentialing status',
                  },
                  {
                    label: 'New Agreement',
                    href: `/admin/agreements?state=${stateAbbr}`,
                    icon: FileText,
                    description: 'Start a new collaborative agreement',
                  },
                  {
                    label: 'State Compliance Data',
                    href: '/admin/states',
                    icon: Shield,
                    description: 'Edit compliance requirements',
                  },
                ]}
              />

              {/* Knowledge Base Link */}
              <RelatedLinksCard
                title="Knowledge Base"
                links={[
                  {
                    label: `${stateCompliance?.state_name || stateAbbr} State Guide`,
                    href: `/knowledge?search=${encodeURIComponent(stateCompliance?.state_name || stateAbbr || '')}`,
                    icon: BookOpen,
                    description: 'SOPs, training, and compliance docs',
                  },
                ]}
              />

              <RelatedLinksCard
                title="Related Physicians"
                links={uniquePhysicians.map(p => ({
                  label: `Dr. ${p.physician_name}`,
                  href: `/physicians/${encodeURIComponent(p.physician_email)}`,
                  description: `${agreements.filter(a => a.physician_email === p.physician_email && a.workflow_status === 'active').length} agreements`,
                }))}
              />

              {stateCompliance?.knowledge_base_url && (
                <RelatedLinksCard
                  title="External Resources"
                  links={[
                    {
                      label: 'State Nursing Board',
                      href: stateCompliance.knowledge_base_url,
                      icon: ExternalLink,
                      external: true,
                    },
                  ]}
                />
              )}
            </div>
          </div>
        </div>
      </main>

      <InitiateLicensureDialog
        open={showLicensureDialog}
        onClose={() => setShowLicensureDialog(false)}
        onSuccess={refetchLicensure}
        preselectedState={stateAbbr}
      />
    </div>
  );
}
