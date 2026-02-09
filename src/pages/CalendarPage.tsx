import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useCalendarEvents, type CalendarEvent } from '@/hooks/useCalendarEvents';
import { CalendarEventCard } from '@/components/calendar/CalendarEventCard';
import { AllHandsEventForm } from '@/components/calendar/AllHandsEventForm';
import { Calendar, Plus, Loader2 } from 'lucide-react';

const CalendarPage = () => {
  const { profile, roles } = useAuth();
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';
  const isAdmin = roles.includes('admin');

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('upcoming');

  const { data: events, isLoading } = useCalendarEvents();

  const now = new Date();
  const allHandsEvents = events?.filter(e => e.event_type === 'provider_all_hands') || [];
  const upcomingEvents = allHandsEvents.filter(e => new Date(e.starts_at) >= now || e.status === 'scheduled');
  const pastEvents = allHandsEvents.filter(e => new Date(e.starts_at) < now && e.status !== 'scheduled');

  const filteredEvents = (activeTab === 'upcoming' ? upcomingEvents : pastEvents)
    .filter(e => statusFilter === 'all' || e.status === statusFilter);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole as any}
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={profile?.avatar_url || undefined}
      />

      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Calendar className="h-6 w-6" />
                Provider All-Hands
              </h1>
              <p className="text-muted-foreground mt-1">
                Schedule events, track recordings, and manage provider attestations.
              </p>
            </div>
            {isAdmin && (
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Event
              </Button>
            )}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between mb-6">
              <TabsList>
                <TabsTrigger value="upcoming">Upcoming ({upcomingEvents.length})</TabsTrigger>
                <TabsTrigger value="past">Past ({pastEvents.length})</TabsTrigger>
              </TabsList>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <TabsContent value="upcoming">
                  {filteredEvents.length === 0 ? (
                    <Card>
                      <CardContent className="py-12 text-center">
                        <Calendar className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-muted-foreground">No upcoming events</p>
                        {isAdmin && (
                          <Button variant="outline" className="mt-4" onClick={() => setCreateDialogOpen(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Schedule an All-Hands
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {filteredEvents.map(event => (
                        <CalendarEventCard key={event.id} event={event} showDetails isAdmin={isAdmin} />
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="past">
                  {filteredEvents.length === 0 ? (
                    <Card>
                      <CardContent className="py-12 text-center">
                        <p className="text-muted-foreground">No past events</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {filteredEvents.map(event => (
                        <CalendarEventCard key={event.id} event={event} showDetails isAdmin={isAdmin} />
                      ))}
                    </div>
                  )}
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </main>

      <AllHandsEventForm open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
};

export default CalendarPage;
