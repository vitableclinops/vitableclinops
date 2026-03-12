import { useState, useEffect } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { EditLicenseDialog } from '@/components/provider/EditLicenseDialog';
import { MapPin, Edit, AlertTriangle, CheckCircle2, Loader2, Plus } from 'lucide-react';

export default function MyLicensesPage() {
  const { profile, roles } = useAuth();
  const [loading, setLoading] = useState(true);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [pendingApps, setPendingApps] = useState<any[]>([]);
  const [editingLicense, setEditingLicense] = useState<any>(null);

  const userName = profile?.full_name || 'Provider';
  const userEmail = profile?.email || '';
  const userRole = roles[0] || 'provider';

  const fetchData = async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [{ data: licenseData }, { data: appData }] = await Promise.all([
        supabase.from('provider_licenses').select('*').eq('profile_id', profile.id).order('state_abbreviation'),
        supabase.from('provider_license_applications').select('*').eq('profile_id', profile.id),
      ]);
      setLicenses(licenseData || []);
      setPendingApps(appData || []);
    } catch (error) {
      console.error('Error fetching licenses:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.id]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
      case 'verified':
        return 'bg-emerald-500/10 text-emerald-600 border-emerald-200';
      case 'reported':
        return 'bg-blue-500/10 text-blue-600 border-blue-200';
      case 'expired':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      default:
        return '';
    }
  };

  const isIncomplete = (license: any) => {
    return !license.license_number || !license.expiration_date;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppSidebar userRole={userRole as any} userName={userName} userEmail={userEmail} userAvatarUrl={profile?.avatar_url || undefined} />
        <main className="pl-64 transition-all duration-300">
          <div className="flex items-center justify-center min-h-screen">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
            <h1 className="text-2xl font-bold text-foreground">My Licenses</h1>
            <p className="text-muted-foreground mt-1">
              View and manage your state licenses.
            </p>
          </div>

          {/* Incomplete licenses alert */}
          {licenses.some(isIncomplete) && (
            <Card className="mb-6 border-amber-200 bg-amber-50/50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-800">Some licenses need attention</p>
                    <p className="text-sm text-amber-700 mt-1">
                      {licenses.filter(isIncomplete).length} license(s) are missing details. Click "Edit" to add your license number and expiration date.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Active Licenses */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Active Licenses ({licenses.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {licenses.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No licenses on file.</p>
              ) : (
                <div className="space-y-3">
                  {licenses.map((license) => (
                    <div
                      key={license.id}
                      className={`flex items-center justify-between p-4 rounded-lg border ${
                        isIncomplete(license) ? 'border-amber-200 bg-amber-50/30' : 'bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                          isIncomplete(license) ? 'bg-amber-100' : 'bg-primary/10'
                        }`}>
                          {isIncomplete(license) ? (
                            <AlertTriangle className="h-5 w-5 text-amber-600" />
                          ) : (
                            <MapPin className="h-5 w-5 text-primary" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{license.state_abbreviation}</p>
                            <Badge variant="outline" className={getStatusColor(license.status)}>
                              {license.status || 'Reported'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                            <span>{license.license_type || 'APRN'}</span>
                            {license.license_number ? (
                              <span>#{license.license_number}</span>
                            ) : (
                              <span className="text-amber-600 font-medium">No license number</span>
                            )}
                            {license.expiration_date ? (
                              <span>Exp: {new Date(license.expiration_date).toLocaleDateString()}</span>
                            ) : (
                              <span className="text-amber-600 font-medium">No expiration date</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingLicense(license)}
                        className="gap-1"
                      >
                        <Edit className="h-4 w-4" />
                        Edit
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Applications */}
          {pendingApps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Pending Applications ({pendingApps.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pendingApps.map((app) => (
                    <div key={app.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                          <Clock className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium">{app.state_abbreviation}</p>
                          <p className="text-sm text-muted-foreground">
                            {app.application_submitted_date
                              ? `Submitted ${new Date(app.application_submitted_date).toLocaleDateString()}`
                              : 'Application pending'}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-blue-600 border-blue-200">Pending</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {editingLicense && (
            <EditLicenseDialog
              open={!!editingLicense}
              onOpenChange={(open) => !open && setEditingLicense(null)}
              license={editingLicense}
              onSaved={fetchData}
            />
          )}
        </div>
      </main>
    </div>
  );
}