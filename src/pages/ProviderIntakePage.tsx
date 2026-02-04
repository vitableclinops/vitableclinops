import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { SelfReportedLicenseCard } from '@/components/SelfReportedLicenseCard';
import { StatCard } from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  providers, 
  selfReportedLicenses,
  states
} from '@/data/mockData';
import { 
  UserPlus, 
  FileText, 
  Clock,
  CheckCircle2,
  Search,
  ChevronRight,
  Upload
} from 'lucide-react';

const ProviderIntakePage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('pending');

  const pendingLicenses = selfReportedLicenses.filter(l => l.verificationStatus === 'pending');
  const verifiedLicenses = selfReportedLicenses.filter(l => l.verificationStatus === 'verified');
  const rejectedLicenses = selfReportedLicenses.filter(l => l.verificationStatus === 'rejected');

  const handleVerify = (license: typeof selfReportedLicenses[0]) => {
    console.log('Verify license:', license.id);
    // In real app, this would call an API
  };

  const handleReject = (license: typeof selfReportedLicenses[0]) => {
    console.log('Reject license:', license.id);
    // In real app, this would open a dialog for rejection reason
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole="admin"
        userName="Sarah Chen"
        userEmail="sarah.chen@example.com"
      />
      
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Provider Intake
              </h1>
              <p className="text-muted-foreground mt-1">
                Review and verify self-reported licenses from providers.
              </p>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <StatCard
              title="Pending Verification"
              value={pendingLicenses.length}
              subtitle="Needs review"
              icon={Clock}
              variant={pendingLicenses.length > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Verified"
              value={verifiedLicenses.length}
              subtitle="This month"
              icon={CheckCircle2}
              variant="success"
            />
            <StatCard
              title="Total Providers"
              value={providers.length}
              subtitle="In system"
              icon={UserPlus}
              variant="default"
            />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="pending" className="gap-2">
                <Clock className="h-4 w-4" />
                Pending ({pendingLicenses.length})
              </TabsTrigger>
              <TabsTrigger value="verified" className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Verified
              </TabsTrigger>
              <TabsTrigger value="providers" className="gap-2">
                <UserPlus className="h-4 w-4" />
                All Providers
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending">
              {pendingLicenses.length > 0 ? (
                <div className="space-y-4">
                  {pendingLicenses.map(license => (
                    <SelfReportedLicenseCard 
                      key={license.id} 
                      license={license}
                      onVerify={handleVerify}
                      onReject={handleReject}
                    />
                  ))}
                </div>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="py-12 text-center">
                    <CheckCircle2 className="h-12 w-12 mx-auto text-success mb-3" />
                    <p className="text-muted-foreground">No licenses pending verification</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="verified">
              <div className="space-y-4">
                {verifiedLicenses.map(license => (
                  <SelfReportedLicenseCard 
                    key={license.id} 
                    license={license}
                  />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="providers">
              {/* Search */}
              <div className="relative max-w-md mb-6">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search providers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {providers.map(provider => {
                  const providerLicenses = selfReportedLicenses.filter(l => l.providerId === provider.id);
                  const licensedStates = provider.states.filter(s => s.isLicensed);
                  
                  return (
                    <Card key={provider.id} className="card-interactive cursor-pointer group">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarFallback className="bg-primary/10 text-primary text-sm">
                              {getInitials(provider.firstName, provider.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground">
                              {provider.firstName} {provider.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {provider.specialty}
                            </p>
                            
                            <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <FileText className="h-4 w-4" />
                                <span>{licensedStates.length} licensed</span>
                              </div>
                              {providerLicenses.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <Upload className="h-4 w-4" />
                                  <span>{providerLicenses.length} self-reported</span>
                                </div>
                              )}
                            </div>
                            
                            <div className="flex flex-wrap gap-1 mt-3">
                              {licensedStates.slice(0, 4).map(ps => (
                                <Badge key={ps.id} variant="secondary" className="text-xs">
                                  {ps.state.abbreviation}
                                </Badge>
                              ))}
                              {licensedStates.length > 4 && (
                                <Badge variant="secondary" className="text-xs">
                                  +{licensedStates.length - 4}
                                </Badge>
                              )}
                            </div>
                          </div>
                          
                          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

export default ProviderIntakePage;
