import { useState } from 'react';
import { CollaborativeAgreementCard } from '@/components/CollaborativeAgreementCard';
import { SupervisionCalendar } from '@/components/SupervisionCalendar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
  LogOut,
  ChevronRight,
  MapPin,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Simulating physician login - in real app this would come from auth context
const currentPhysician = collaboratingPhysicians[0];

const PhysicianPortal = () => {
  const [activeTab, setActiveTab] = useState('overview');

  // Get agreements for this physician
  const myAgreements = collaborativeAgreements.filter(a => a.physicianId === currentPhysician.id);
  const myProviders = providers.filter(p => 
    myAgreements.some(a => a.providerIds.includes(p.id))
  );
  const myMeetings = supervisionMeetings.filter(m => 
    m.attendees.physicianId === currentPhysician.id
  );
  
  const upcomingMeetings = myMeetings.filter(m => 
    m.status === 'scheduled' && new Date(m.scheduledDate) >= new Date()
  );
  const pendingRenewals = myAgreements.filter(a => a.status === 'pending_renewal');

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Simple header for physician portal */}
      <header className="border-b bg-card">
        <div className="flex items-center justify-between px-8 py-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <Users className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-semibold text-foreground">Physician Portal</h1>
              <p className="text-sm text-muted-foreground">Collaborative Agreement Management</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">
                Dr. {currentPhysician.firstName} {currentPhysician.lastName}
              </p>
              <p className="text-xs text-muted-foreground">{currentPhysician.specialty}</p>
            </div>
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary/10 text-primary">
                {getInitials(currentPhysician.firstName, currentPhysician.lastName)}
              </AvatarFallback>
            </Avatar>
            <Button variant="ghost" size="icon">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>
      
      <main className="p-8 max-w-7xl mx-auto">
        {/* Welcome section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground">
            Welcome back, Dr. {currentPhysician.lastName}
          </h2>
          <p className="text-muted-foreground mt-1">
            You are supervising {myProviders.length} provider{myProviders.length !== 1 ? 's' : ''} across {myAgreements.length} agreement{myAgreements.length !== 1 ? 's' : ''}.
          </p>
        </div>

        {/* Alerts */}
        {(pendingRenewals.length > 0 || upcomingMeetings.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2 mb-8">
            {pendingRenewals.length > 0 && (
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Agreements Pending Renewal</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {pendingRenewals.length} agreement{pendingRenewals.length !== 1 ? 's' : ''} need{pendingRenewals.length === 1 ? 's' : ''} to be renewed soon.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {upcomingMeetings.length > 0 && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Calendar className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Upcoming Meetings</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        You have {upcomingMeetings.length} meeting{upcomingMeetings.length !== 1 ? 's' : ''} scheduled.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview" className="gap-2">
              <Users className="h-4 w-4" />
              Providers
            </TabsTrigger>
            <TabsTrigger value="agreements" className="gap-2">
              <FileText className="h-4 w-4" />
              Agreements
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-2">
              <Calendar className="h-4 w-4" />
              Meetings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Supervised Providers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {myProviders.map(provider => {
                    const providerAgreements = myAgreements.filter(a => 
                      a.providerIds.includes(provider.id)
                    );
                    
                    return (
                      <div 
                        key={provider.id}
                        className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer group"
                      >
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {getInitials(provider.firstName, provider.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground">
                            {provider.firstName} {provider.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {provider.specialty}
                          </p>
                          
                          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              <span>
                                {providerAgreements.map(a => {
                                  const state = states.find(s => s.id === a.stateId);
                                  return state?.abbreviation;
                                }).join(', ')}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <FileText className="h-4 w-4" />
                              <span>{providerAgreements.length} agreement{providerAgreements.length !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                        </div>
                        
                        <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="agreements">
            <div className="grid gap-4 md:grid-cols-2">
              {myAgreements.map(agreement => (
                <CollaborativeAgreementCard 
                  key={agreement.id} 
                  agreement={agreement}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="calendar">
            <SupervisionCalendar meetings={myMeetings} showAddButton={false} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default PhysicianPortal;
