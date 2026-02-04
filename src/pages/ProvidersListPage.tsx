import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { StatusBadge } from '@/components/StatusBadge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { providers, states } from '@/data/mockData';
import { 
  Search,
  Filter,
  ChevronRight,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Shield,
  MoreHorizontal,
  Edit,
  Eye,
  UserPlus
} from 'lucide-react';
import type { Provider } from '@/types';
import { cn } from '@/lib/utils';

const ProvidersListPage = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'ready' | 'blocked' | 'pending'>('all');

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  const getProviderSummary = (provider: Provider) => {
    const totalTasks = provider.states.flatMap(s => s.tasks).length;
    const completedTasks = provider.states.flatMap(s => 
      s.tasks.filter(t => ['verified', 'approved'].includes(t.status))
    ).length;
    const blockedTasks = provider.states.flatMap(s => 
      s.tasks.filter(t => t.status === 'blocked')
    ).length;
    const readyStates = provider.states.filter(s => s.isReadyForActivation);
    const hasBlockers = blockedTasks > 0;
    const isReady = readyStates.length > 0;

    return { totalTasks, completedTasks, blockedTasks, readyStates, hasBlockers, isReady };
  };

  const filteredProviders = providers.filter(provider => {
    const matchesSearch = 
      `${provider.firstName} ${provider.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      provider.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      provider.npiNumber.includes(searchQuery);

    if (!matchesSearch) return false;

    const summary = getProviderSummary(provider);
    
    switch (selectedFilter) {
      case 'ready':
        return summary.isReady;
      case 'blocked':
        return summary.hasBlockers;
      case 'pending':
        return summary.totalTasks > summary.completedTasks && !summary.hasBlockers;
      default:
        return true;
    }
  });

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
                All Providers
              </h1>
              <p className="text-muted-foreground mt-1">
                View and manage provider licensure status across all states.
              </p>
            </div>
            <Button onClick={() => navigate('/onboarding?mode=admin')}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Provider
            </Button>
          </div>

          {/* Filters */}
          <Card className="mb-6">
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, email, or NPI..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <Button 
                    variant={selectedFilter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedFilter('all')}
                  >
                    All
                  </Button>
                  <Button 
                    variant={selectedFilter === 'ready' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedFilter('ready')}
                    className={selectedFilter === 'ready' ? '' : 'text-success border-success/30 hover:bg-success/10'}
                  >
                    <Shield className="h-4 w-4 mr-1" />
                    Ready
                  </Button>
                  <Button 
                    variant={selectedFilter === 'blocked' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedFilter('blocked')}
                    className={selectedFilter === 'blocked' ? '' : 'text-destructive border-destructive/30 hover:bg-destructive/10'}
                  >
                    <AlertTriangle className="h-4 w-4 mr-1" />
                    Blocked
                  </Button>
                  <Button 
                    variant={selectedFilter === 'pending' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedFilter('pending')}
                    className={selectedFilter === 'pending' ? '' : 'text-warning border-warning/30 hover:bg-warning/10'}
                  >
                    <Clock className="h-4 w-4 mr-1" />
                    In Progress
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Providers table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px]">Provider</TableHead>
                    <TableHead>Specialty</TableHead>
                    <TableHead>States</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProviders.map(provider => {
                    const summary = getProviderSummary(provider);
                    
                    return (
                      <TableRow 
                        key={provider.id}
                        className="cursor-pointer hover:bg-muted/50"
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {getInitials(provider.firstName, provider.lastName)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-foreground">
                                {provider.firstName} {provider.lastName}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                NPI: {provider.npiNumber}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {provider.specialty}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {provider.states.slice(0, 4).map(ps => (
                              <Badge 
                                key={ps.id} 
                                variant="secondary"
                                className={cn(
                                  'text-xs',
                                  ps.isReadyForActivation && 'bg-success/10 text-success border-success/20',
                                  ps.tasks.some(t => t.status === 'blocked') && 'bg-destructive/10 text-destructive border-destructive/20'
                                )}
                              >
                                {ps.state.abbreviation}
                              </Badge>
                            ))}
                            {provider.states.length > 4 && (
                              <span className="text-xs text-muted-foreground">
                                +{provider.states.length - 4}
                              </span>
                            )}
                            {provider.states.length === 0 && (
                              <span className="text-sm text-muted-foreground">No states assigned</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {summary.totalTasks > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-2 rounded-full bg-secondary overflow-hidden">
                                <div 
                                  className={cn(
                                    'h-full rounded-full',
                                    summary.hasBlockers ? 'bg-destructive' : 'bg-success'
                                  )}
                                  style={{ width: `${(summary.completedTasks / summary.totalTasks) * 100}%` }}
                                />
                              </div>
                              <span className="text-sm text-muted-foreground">
                                {summary.completedTasks}/{summary.totalTasks}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {summary.isReady ? (
                            <Badge className="bg-success/10 text-success border-success/20">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Ready
                            </Badge>
                          ) : summary.hasBlockers ? (
                            <Badge className="bg-destructive/10 text-destructive border-destructive/20">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Blocked
                            </Badge>
                          ) : summary.totalTasks > 0 ? (
                            <Badge className="bg-warning/10 text-warning border-warning/20">
                              <Clock className="h-3 w-3 mr-1" />
                              In Progress
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              New
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/onboarding?mode=admin&providerId=${provider.id}`)}>
                                <Edit className="h-4 w-4 mr-2" />
                                Edit Provider
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Eye className="h-4 w-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredProviders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <p className="text-muted-foreground">No providers found</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default ProvidersListPage;
