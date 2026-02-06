import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { usePhysicianPortal } from '@/hooks/usePhysicianPortal';
import { format, formatDistanceToNow, isAfter } from 'date-fns';
import { 
  Users, 
  FileText, 
  Calendar, 
  LogOut,
  ChevronRight,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ClipboardList,
  Video,
  ExternalLink,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';

const PhysicianPortal = () => {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  
  const {
    agreements,
    uniqueProviders,
    upcomingMeetings,
    pastMeetings,
    tasks,
    stats,
    loading,
    error,
    refetch,
    getAgreementsForProvider,
  } = usePhysicianPortal();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-success/20 text-success">Active</Badge>;
      case 'pending_renewal':
        return <Badge className="bg-warning/20 text-warning">Pending Renewal</Badge>;
      case 'pending_signature':
        return <Badge className="bg-info/20 text-info">Pending Signature</Badge>;
      case 'terminated':
        return <Badge className="bg-destructive/20 text-destructive">Terminated</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="flex items-center justify-between px-8 py-4">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-10 w-32" />
          </div>
        </header>
        <main className="p-8 max-w-7xl mx-auto">
          <Skeleton className="h-8 w-64 mb-8" />
          <div className="grid gap-4 md:grid-cols-4 mb-8">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Error Loading Portal</h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={refetch}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
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
                {profile?.full_name || 'Physician'}
              </p>
              <p className="text-xs text-muted-foreground">{profile?.credentials || 'MD'}</p>
            </div>
            <Avatar className="h-10 w-10">
              <AvatarImage src={profile?.avatar_url || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary">
                {getInitials(profile?.full_name || 'MD')}
              </AvatarFallback>
            </Avatar>
            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>
      
      <main className="p-8 max-w-7xl mx-auto">
        {/* Welcome section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground">
            Welcome back, {profile?.full_name?.split(' ')[0] || 'Doctor'}
          </h2>
          <p className="text-muted-foreground mt-1">
            You are supervising {stats.activeProviders} provider{stats.activeProviders !== 1 ? 's' : ''} across {stats.activeAgreements} active agreement{stats.activeAgreements !== 1 ? 's' : ''}.
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.activeProviders}</p>
                  <p className="text-sm text-muted-foreground">Active Providers</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-success/10">
                  <FileText className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.activeAgreements}</p>
                  <p className="text-sm text-muted-foreground">Active Agreements</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-info/10">
                  <Calendar className="h-5 w-5 text-info" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.upcomingMeetings}</p>
                  <p className="text-sm text-muted-foreground">Upcoming Meetings</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-lg",
                  stats.pendingRenewals > 0 ? "bg-warning/10" : "bg-muted"
                )}>
                  <ClipboardList className={cn(
                    "h-5 w-5",
                    stats.pendingRenewals > 0 ? "text-warning" : "text-muted-foreground"
                  )} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.pendingRenewals}</p>
                  <p className="text-sm text-muted-foreground">Pending Renewals</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Alerts */}
        {(stats.pendingRenewals > 0 || stats.pendingTasks > 0) && (
          <div className="grid gap-4 md:grid-cols-2 mb-8">
            {stats.pendingRenewals > 0 && (
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Agreements Pending Renewal</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {stats.pendingRenewals} agreement{stats.pendingRenewals !== 1 ? 's' : ''} need{stats.pendingRenewals === 1 ? 's' : ''} to be renewed soon.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {stats.pendingTasks > 0 && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <ClipboardList className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Pending Tasks</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        You have {stats.pendingTasks} task{stats.pendingTasks !== 1 ? 's' : ''} requiring attention.
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
              Providers ({stats.activeProviders})
            </TabsTrigger>
            <TabsTrigger value="agreements" className="gap-2">
              <FileText className="h-4 w-4" />
              Agreements ({stats.totalAgreements})
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-2">
              <Calendar className="h-4 w-4" />
              Meetings ({stats.upcomingMeetings})
            </TabsTrigger>
            {stats.pendingTasks > 0 && (
              <TabsTrigger value="tasks" className="gap-2">
                <ClipboardList className="h-4 w-4" />
                Tasks ({stats.pendingTasks})
              </TabsTrigger>
            )}
          </TabsList>

          {/* Providers Tab */}
          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Supervised Providers</CardTitle>
              </CardHeader>
              <CardContent>
                {uniqueProviders.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No providers assigned yet</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {uniqueProviders.map(provider => {
                      const providerAgreements = getAgreementsForProvider(provider.provider_email);
                      const states = [...new Set(providerAgreements.map(a => a.state_abbreviation))];
                      
                      return (
                        <div 
                          key={provider.id}
                          className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer group"
                        >
                          <Avatar className="h-12 w-12">
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {getInitials(provider.provider_name)}
                            </AvatarFallback>
                          </Avatar>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-foreground">
                                {provider.provider_name}
                              </p>
                              {provider.is_active === false && (
                                <Badge variant="secondary" className="text-xs">Inactive</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {provider.provider_email}
                            </p>
                            
                            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <MapPin className="h-4 w-4" />
                                <span>{states.join(', ') || 'No states'}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <FileText className="h-4 w-4" />
                                <span>{providerAgreements.length} agreement{providerAgreements.length !== 1 ? 's' : ''}</span>
                              </div>
                              {provider.chart_review_url && (
                                <a 
                                  href={provider.chart_review_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-primary hover:underline"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Chart Reviews
                                </a>
                              )}
                            </div>
                          </div>
                          
                          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Agreements Tab */}
          <TabsContent value="agreements">
            <div className="grid gap-4 md:grid-cols-2">
              {agreements.length === 0 ? (
                <Card className="col-span-2">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No agreements found</p>
                  </CardContent>
                </Card>
              ) : (
                agreements.map(agreement => (
                  <Card key={agreement.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          {agreement.state_name}
                        </CardTitle>
                        {getStatusBadge(agreement.workflow_status)}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        {agreement.start_date && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Start Date</span>
                            <span>{format(new Date(agreement.start_date), 'MMM d, yyyy')}</span>
                          </div>
                        )}
                        {agreement.next_renewal_date && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Next Renewal</span>
                            <span className={cn(
                              isAfter(new Date(), new Date(agreement.next_renewal_date)) && 'text-destructive'
                            )}>
                              {format(new Date(agreement.next_renewal_date), 'MMM d, yyyy')}
                            </span>
                          </div>
                        )}
                        {agreement.meeting_cadence && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Meeting Cadence</span>
                            <span className="capitalize">{agreement.meeting_cadence}</span>
                          </div>
                        )}
                        <div className="pt-2">
                          <Link 
                            to={`/admin/agreements/${agreement.id}`}
                            className="text-primary text-sm hover:underline inline-flex items-center gap-1"
                          >
                            View Details
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Meetings Tab */}
          <TabsContent value="calendar">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Upcoming Meetings */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Upcoming Meetings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {upcomingMeetings.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                      <Calendar className="h-10 w-10 mx-auto mb-2 opacity-50" />
                      <p>No upcoming meetings</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-3">
                        {upcomingMeetings.map(meeting => (
                          <div 
                            key={meeting.id}
                            className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                          >
                            <div className="flex flex-col items-center min-w-[45px] text-center">
                              <span className="text-xs text-muted-foreground uppercase">
                                {format(new Date(meeting.scheduled_date), 'EEE')}
                              </span>
                              <span className="text-xl font-bold">
                                {format(new Date(meeting.scheduled_date), 'd')}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(meeting.scheduled_date), 'MMM')}
                              </span>
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="secondary" className="text-xs">
                                  {meeting.state_abbreviation || 'All'}
                                </Badge>
                                <span className="text-xs text-muted-foreground capitalize">
                                  {meeting.meeting_type?.replace(/_/g, ' ') || 'Meeting'}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                <span>{format(new Date(meeting.scheduled_date), 'h:mm a')}</span>
                                {meeting.duration_minutes && (
                                  <span>({meeting.duration_minutes} min)</span>
                                )}
                              </div>
                              
                              {meeting.video_link && (
                                <a 
                                  href={meeting.video_link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1"
                                >
                                  <Video className="h-3 w-3" />
                                  Join Meeting
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>

              {/* Past Meetings */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-success" />
                    Recent Meetings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {pastMeetings.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                      <CheckCircle2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
                      <p>No recent meetings</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-3">
                        {pastMeetings.map(meeting => (
                          <div 
                            key={meeting.id}
                            className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30"
                          >
                            <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {meeting.state_abbreviation || 'All'}
                                </Badge>
                                <span className="text-sm capitalize">
                                  {meeting.meeting_type?.replace(/_/g, ' ') || 'Meeting'}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {format(new Date(meeting.scheduled_date), 'MMM d, yyyy')} • 
                                {formatDistanceToNow(new Date(meeting.scheduled_date), { addSuffix: true })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Pending Tasks
                </CardTitle>
              </CardHeader>
              <CardContent>
                {tasks.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-success" />
                    <p>All tasks completed!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {tasks.map(task => (
                      <div 
                        key={task.id}
                        className="flex items-start gap-3 p-4 rounded-lg border bg-card"
                      >
                        <div className={cn(
                          "p-2 rounded-lg",
                          task.priority === 'high' ? 'bg-destructive/10' : 'bg-muted'
                        )}>
                          <ClipboardList className={cn(
                            "h-4 w-4",
                            task.priority === 'high' ? 'text-destructive' : 'text-muted-foreground'
                          )} />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{task.title}</span>
                            {task.priority === 'high' && (
                              <Badge variant="destructive" className="text-xs">High Priority</Badge>
                            )}
                          </div>
                          {task.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {task.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            {task.state_abbreviation && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {task.state_abbreviation}
                              </span>
                            )}
                            {task.due_date && (
                              <span className={cn(
                                "flex items-center gap-1",
                                new Date(task.due_date) < new Date() && 'text-destructive'
                              )}>
                                <Clock className="h-3 w-3" />
                                Due {format(new Date(task.due_date), 'MMM d')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default PhysicianPortal;
