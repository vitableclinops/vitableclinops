import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { CollaborativeAgreementCard } from '@/components/CollaborativeAgreementCard';
import { SupervisionCalendar } from '@/components/SupervisionCalendar';
import { StatCard } from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  collaborativeAgreements, 
  supervisionMeetings, 
  collaboratingPhysicians,
  providers,
  states
} from '@/data/mockData';
import { 
  Users, 
  FileText, 
  Calendar, 
  AlertTriangle,
  Search,
  Plus,
  Clock,
  CheckCircle2
} from 'lucide-react';

const CollaborativeAgreementsPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('agreements');

  const activeAgreements = collaborativeAgreements.filter(a => a.status === 'active');
  const pendingRenewal = collaborativeAgreements.filter(a => a.status === 'pending_renewal');
  const upcomingMeetings = supervisionMeetings.filter(m => 
    m.status === 'scheduled' && new Date(m.scheduledDate) >= new Date()
  );
  const missedMeetings = supervisionMeetings.filter(m => m.status === 'missed');

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
                Collaborative Agreements
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage physician collaborations, supervision schedules, and renewals.
              </p>
            </div>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Agreement
            </Button>
          </div>

          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-4 mb-8">
            <StatCard
              title="Active Agreements"
              value={activeAgreements.length}
              subtitle={`${collaboratingPhysicians.length} physicians`}
              icon={FileText}
              variant="success"
            />
            <StatCard
              title="Pending Renewal"
              value={pendingRenewal.length}
              subtitle="Requires attention"
              icon={AlertTriangle}
              variant={pendingRenewal.length > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Upcoming Meetings"
              value={upcomingMeetings.length}
              subtitle="Next 30 days"
              icon={Calendar}
              variant="default"
            />
            <StatCard
              title="Missed Meetings"
              value={missedMeetings.length}
              subtitle="Needs rescheduling"
              icon={Clock}
              variant={missedMeetings.length > 0 ? 'danger' : 'default'}
            />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="agreements" className="gap-2">
                <FileText className="h-4 w-4" />
                Agreements
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-2">
                <Calendar className="h-4 w-4" />
                Supervision Calendar
              </TabsTrigger>
              <TabsTrigger value="physicians" className="gap-2">
                <Users className="h-4 w-4" />
                Physicians
              </TabsTrigger>
            </TabsList>

            <TabsContent value="agreements">
              {/* Search */}
              <div className="relative max-w-md mb-6">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search agreements..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Agreements needing renewal */}
              {pendingRenewal.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-warning" />
                    Pending Renewal
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {pendingRenewal.map(agreement => (
                      <CollaborativeAgreementCard 
                        key={agreement.id} 
                        agreement={agreement}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Active agreements */}
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  Active Agreements
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {activeAgreements.map(agreement => (
                    <CollaborativeAgreementCard 
                      key={agreement.id} 
                      agreement={agreement}
                    />
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="calendar">
              <SupervisionCalendar meetings={supervisionMeetings} />
            </TabsContent>

            <TabsContent value="physicians">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {collaboratingPhysicians.map(physician => {
                  const physicianAgreements = collaborativeAgreements.filter(
                    a => a.physicianId === physician.id
                  );
                  const supervisedProviders = providers.filter(p =>
                    physicianAgreements.some(a => a.providerIds.includes(p.id))
                  );

                  return (
                    <Card key={physician.id} className="card-interactive cursor-pointer">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-lg font-semibold text-primary">
                              {physician.firstName[0]}{physician.lastName[0]}
                            </span>
                          </div>
                          <div>
                            <CardTitle className="text-base">
                              Dr. {physician.firstName} {physician.lastName}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                              {physician.specialty}
                            </p>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <FileText className="h-4 w-4" />
                          <span>{physicianAgreements.length} agreement{physicianAgreements.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Users className="h-4 w-4" />
                          <span>{supervisedProviders.length} provider{supervisedProviders.length !== 1 ? 's' : ''} supervised</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {physicianAgreements.map(a => {
                            const state = states.find(s => s.id === a.stateId);
                            return (
                              <Badge key={a.id} variant="secondary" className="text-xs">
                                {state?.abbreviation}
                              </Badge>
                            );
                          })}
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

export default CollaborativeAgreementsPage;
