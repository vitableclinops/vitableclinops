import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useCalendarEvents, type CalendarEvent } from '@/hooks/useCalendarEvents';
import { useUpcomingMilestones, type MilestoneTask } from '@/hooks/useMilestones';
import { CalendarEventCard } from '@/components/calendar/CalendarEventCard';
import { AllHandsEventForm } from '@/components/calendar/AllHandsEventForm';
import { Calendar, Plus, Loader2, Cake, Trophy, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, differenceInDays } from 'date-fns';

/** Parse a YYYY-MM-DD string as a local date to avoid UTC timezone shift */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const CalendarPage = () => {
  const { profile, roles } = useAuth();
  const navigate = useNavigate();
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';
  const isAdmin = roles.includes('admin');
  const isPodLead = roles.includes('pod_lead');

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('upcoming');

  const { data: events, isLoading } = useCalendarEvents();
  const { data: milestones, isLoading: milestonesLoading } = useUpcomingMilestones(60);

  // Fetch pod lead's pod to filter milestones
  const { data: myPod } = useQuery({
    queryKey: ['my-pod-for-calendar', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const { data } = await supabase
        .from('pods')
        .select('id, name')
        .eq('pod_lead_id', profile.id)
        .maybeSingle();
      return data;
    },
    enabled: isPodLead && !!profile?.id,
  });

  const now = new Date();
  // Include all-hands, pod meetings, and collaborative meetings
  const allRelevantEvents = events?.filter(e => 
    ['provider_all_hands', 'pod_meeting', 'supervision_meeting'].includes(e.event_type)
  ) || [];
  const upcomingEvents = allRelevantEvents.filter(e => new Date(e.starts_at) >= now || e.status === 'scheduled');
  const pastEvents = allRelevantEvents.filter(e => new Date(e.starts_at) < now && e.status !== 'scheduled');

  const filteredEvents = (activeTab === 'upcoming' ? upcomingEvents : pastEvents)
    .filter(e => statusFilter === 'all' || e.status === statusFilter)
    .filter(e => eventTypeFilter === 'all' || e.event_type === eventTypeFilter);

  // Filter milestones: pod leads see only their pod, admins see all
  const pendingMilestones = (milestones?.filter(m => m.status === 'pending') || []).filter(m => {
    if (isAdmin) return true;
    if (isPodLead && myPod) return m.pod_id === myPod.id;
    return false;
  });

  // Separate birthday milestones for calendar display
  const birthdayMilestones = pendingMilestones.filter(m => m.milestone_type === 'birthday');
  const anniversaryMilestones = pendingMilestones.filter(m => m.milestone_type === 'anniversary');

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
                Calendar
              </h1>
              <p className="text-muted-foreground mt-1">
                Team meetings, provider milestones, and upcoming celebrations.
              </p>
            </div>
            {isAdmin && (
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Event
              </Button>
            )}
          </div>

          {/* Milestone Banner - Birthdays & Anniversaries */}
          {pendingMilestones.length > 0 && (
            <Card className="mb-6 border-pink-200 dark:border-pink-800 bg-pink-50/50 dark:bg-pink-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Cake className="h-5 w-5 text-pink-500" />
                  Upcoming Milestones
                  <Badge variant="secondary">{pendingMilestones.length}</Badge>
                  {isPodLead && myPod && (
                    <Badge variant="outline" className="text-[10px] ml-1">
                      {myPod.name}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {pendingMilestones.slice(0, 6).map(m => {
                    const daysUntil = differenceInDays(parseLocalDate(m.milestone_date), new Date());
                    const isBirthday = m.milestone_type === 'birthday';
                    const isUrgent = daysUntil <= 1;
                    
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer",
                          isUrgent && "border-warning bg-warning/5",
                          !m.assigned_to && "border-dashed border-destructive/40"
                        )}
                        onClick={() => navigate(`/directory`)}
                      >
                        <div className={cn(
                          "p-2 rounded-lg shrink-0",
                          isBirthday
                            ? "bg-pink-100 text-pink-600 dark:bg-pink-900 dark:text-pink-300"
                            : "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300"
                        )}>
                          {isBirthday ? <Cake className="h-4 w-4" /> : <Trophy className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.provider_name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{isBirthday ? 'Birthday' : 'Anniversary'}</span>
                            <span>·</span>
                            <span>{format(parseLocalDate(m.milestone_date), 'MMM d')}</span>
                          </div>
                          {!m.assigned_to && (
                            <Badge variant="outline" className="text-[10px] mt-1 border-destructive/40 text-destructive">
                              Unassigned
                            </Badge>
                          )}
                        </div>
                        <Badge
                          variant={isUrgent ? "destructive" : "secondary"}
                          className="shrink-0 text-[10px]"
                        >
                          {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
                {pendingMilestones.length > 6 && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    + {pendingMilestones.length - 6} more milestones
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between mb-6">
              <TabsList>
                <TabsTrigger value="upcoming">Upcoming ({upcomingEvents.length})</TabsTrigger>
                <TabsTrigger value="past">Past ({pastEvents.length})</TabsTrigger>
              </TabsList>
              <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Event type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="provider_all_hands">All-Hands</SelectItem>
                  <SelectItem value="supervision_meeting">Supervision</SelectItem>
                  <SelectItem value="pod_meeting">Pod Meeting</SelectItem>
                </SelectContent>
              </Select>
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