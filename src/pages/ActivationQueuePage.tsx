import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { 
  AlertTriangle, 
  Power, 
  PowerOff, 
  Search,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  Users,
  BarChart3
} from 'lucide-react';
import {
  useProviderStateStatuses,
  useActivationStats,
  type EhrActivationStatus,
} from '@/hooks/useProviderStateStatus';
import {
  ActivationStatusBadge,
  ReadinessStatusBadge,
  MismatchBadge,
} from '@/components/activation/ActivationStatusBadge';
import { ActivationActionDialog } from '@/components/activation/ActivationActionDialog';
import { cn } from '@/lib/utils';
import type { Enums } from '@/integrations/supabase/types';

type MismatchType = Enums<'mismatch_type'>;

export default function ActivationQueuePage() {
  const { profile, roles } = useAuth();
  const [activeTab, setActiveTab] = useState<'mismatches' | 'requests' | 'all'>('mismatches');
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<{
    providerId: string;
    providerName: string;
    stateAbbreviation: string;
    stateName: string;
    currentStatus: EhrActivationStatus;
    readinessStatus: string;
    readinessReason?: string | null;
  } | null>(null);
  const [actionType, setActionType] = useState<'activate' | 'deactivate' | 'request_activation' | 'request_deactivation'>('activate');

  // Fetch stats
  const { data: stats, isLoading: statsLoading } = useActivationStats();

  // Fetch all statuses
  const { data: allStatuses, isLoading: statusesLoading } = useProviderStateStatuses();

  // Fetch profiles to get names and filter terminated
  const { data: profiles } = useQuery({
    queryKey: ['profiles-for-activation'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, employment_status')
        .neq('employment_status', 'termed');
      return data || [];
    },
  });

  // Create a lookup for provider names
  const profileLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    profiles?.forEach(p => {
      lookup[p.id] = p.full_name || p.email || 'Unknown';
    });
    return lookup;
  }, [profiles]);

  // Filter data based on tab and search
  const filteredData = useMemo(() => {
    if (!allStatuses) return [];

    // Exclude terminated providers
    const activeProviderIds = new Set(profiles?.map(p => p.id) || []);
    let filtered = allStatuses.filter(s => activeProviderIds.has(s.provider_id));

    // Tab filter
    if (activeTab === 'mismatches') {
      filtered = filtered.filter(s => s.mismatch_type && s.mismatch_type !== 'none');
    } else if (activeTab === 'requests') {
      filtered = filtered.filter(
        s => s.ehr_activation_status === 'activation_requested' || 
             s.ehr_activation_status === 'deactivation_requested'
      );
    }

    // State filter
    if (stateFilter !== 'all') {
      filtered = filtered.filter(s => s.state_abbreviation === stateFilter);
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(s => {
        const providerName = profileLookup[s.provider_id]?.toLowerCase() || '';
        return providerName.includes(query) || 
               s.state_abbreviation.toLowerCase().includes(query);
      });
    }

    // Sort: critical mismatches first
    filtered.sort((a, b) => {
      const criticalMismatches: MismatchType[] = ['active_but_not_ready', 'expired_license_but_active', 'expired_collab_but_active'];
      const aIsCritical = a.mismatch_type && criticalMismatches.includes(a.mismatch_type);
      const bIsCritical = b.mismatch_type && criticalMismatches.includes(b.mismatch_type);
      if (aIsCritical && !bIsCritical) return -1;
      if (!aIsCritical && bIsCritical) return 1;
      return 0;
    });

    return filtered;
  }, [allStatuses, activeTab, stateFilter, searchQuery, profileLookup, profiles]);

  // Get unique states for filter
  const uniqueStates = useMemo(() => {
    if (!allStatuses) return [];
    return [...new Set(allStatuses.map(s => s.state_abbreviation))].sort();
  }, [allStatuses]);

  const handleAction = (
    item: typeof selectedItem, 
    action: typeof actionType
  ) => {
    setSelectedItem(item);
    setActionType(action);
    setActionDialogOpen(true);
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const isLoading = statsLoading || statusesLoading;

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={roles[0] || 'admin'}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />

      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8">
          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">EHR Activation Queue</h1>
              <p className="text-muted-foreground">
                Manage provider activation status and resolve compliance mismatches
              </p>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-6">
            <Card className={cn(
              "cursor-pointer transition-colors",
              activeTab === 'mismatches' && "border-destructive"
            )} onClick={() => setActiveTab('mismatches')}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Critical Mismatches</p>
                    <p className="text-2xl font-bold text-destructive">
                      {isLoading ? '-' : stats?.activeButNotReady || 0}
                    </p>
                  </div>
                  <ShieldAlert className="h-8 w-8 text-destructive/50" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Active & Ready</p>
                    <p className="text-2xl font-bold text-success">
                      {isLoading ? '-' : stats?.activeAndReady || 0}
                    </p>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-success/50" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Ready but Inactive</p>
                    <p className="text-2xl font-bold text-info">
                      {isLoading ? '-' : stats?.inactiveAndReady || 0}
                    </p>
                  </div>
                  <Clock className="h-8 w-8 text-info/50" />
                </div>
              </CardContent>
            </Card>

            <Card className={cn(
              "cursor-pointer transition-colors",
              activeTab === 'requests' && "border-primary"
            )} onClick={() => setActiveTab('requests')}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Pending Requests</p>
                    <p className="text-2xl font-bold">
                      {isLoading ? '-' : (stats?.activationRequested || 0) + (stats?.deactivationRequested || 0)}
                    </p>
                  </div>
                  <Users className="h-8 w-8 text-muted-foreground/50" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Records</p>
                    <p className="text-2xl font-bold">{isLoading ? '-' : stats?.total || 0}</p>
                  </div>
                  <BarChart3 className="h-8 w-8 text-muted-foreground/50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card className="mb-6">
            <CardContent className="pt-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by provider name or state..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={stateFilter} onValueChange={setStateFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All States" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All States</SelectItem>
                    {uniqueStates.map(state => (
                      <SelectItem key={state} value={state}>{state}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                  <TabsList>
                    <TabsTrigger value="mismatches" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Mismatches
                      {stats?.activeButNotReady ? (
                        <Badge variant="destructive" className="ml-1 h-5 px-1">
                          {stats.activeButNotReady}
                        </Badge>
                      ) : null}
                    </TabsTrigger>
                    <TabsTrigger value="requests" className="gap-1">
                      <Clock className="h-3 w-3" />
                      Requests
                    </TabsTrigger>
                    <TabsTrigger value="all">All</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardContent>
          </Card>

          {/* Data Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {activeTab === 'mismatches' && 'Compliance Mismatches'}
                {activeTab === 'requests' && 'Pending Activation Requests'}
                {activeTab === 'all' && 'All Provider State Records'}
              </CardTitle>
              <CardDescription>
                {filteredData.length} records
                {selectedIds.size > 0 && ` • ${selectedIds.size} selected`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredData.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 className="h-12 w-12 mx-auto text-success/50 mb-3" />
                  <p className="text-muted-foreground">
                    {activeTab === 'mismatches' 
                      ? 'No compliance mismatches found' 
                      : 'No records found'}
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {filteredData.map(item => {
                      const providerName = profileLookup[item.provider_id] || 'Unknown Provider';
                      const canActivate = item.ehr_activation_status === 'inactive' || 
                        item.ehr_activation_status === 'deactivated' ||
                        item.ehr_activation_status === 'activation_requested';
                      const canDeactivate = item.ehr_activation_status === 'active' ||
                        item.ehr_activation_status === 'deactivation_requested';

                      return (
                        <div 
                          key={item.id}
                          className={cn(
                            "flex items-center gap-4 p-4 border rounded-lg hover:bg-muted/30 transition-colors",
                            item.mismatch_type && item.mismatch_type !== 'none' && 
                            item.mismatch_type !== 'ready_but_inactive' && "border-destructive/50 bg-destructive/5"
                          )}
                        >
                          <Checkbox
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={() => toggleSelection(item.id)}
                          />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Link 
                                to={`/directory?tab=management&search=${encodeURIComponent(providerName)}`}
                                className="font-medium hover:underline truncate"
                              >
                                {providerName}
                              </Link>
                              <Link 
                                to={`/states/${item.state_abbreviation}`}
                                className="hover:underline"
                              >
                                <Badge variant="outline">{item.state_abbreviation}</Badge>
                              </Link>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <ReadinessStatusBadge 
                                status={item.readiness_status}
                                reason={item.readiness_reason}
                              />
                              <ActivationStatusBadge status={item.ehr_activation_status} />
                              <MismatchBadge mismatchType={item.mismatch_type} />
                              {item.readiness_override && (
                                <Badge variant="secondary" className="text-xs">Override</Badge>
                              )}
                            </div>
                            {item.readiness_reason && (
                              <p className="text-xs text-muted-foreground mt-1 truncate">
                                {item.readiness_reason}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {canActivate && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleAction({
                                  providerId: item.provider_id,
                                  providerName,
                                  stateAbbreviation: item.state_abbreviation,
                                  stateName: item.state_abbreviation,
                                  currentStatus: item.ehr_activation_status,
                                  readinessStatus: item.readiness_status,
                                  readinessReason: item.readiness_reason,
                                }, 'activate')}
                              >
                                <Power className="h-3 w-3 mr-1" />
                                Activate
                              </Button>
                            )}
                            {canDeactivate && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleAction({
                                  providerId: item.provider_id,
                                  providerName,
                                  stateAbbreviation: item.state_abbreviation,
                                  stateName: item.state_abbreviation,
                                  currentStatus: item.ehr_activation_status,
                                  readinessStatus: item.readiness_status,
                                  readinessReason: item.readiness_reason,
                                }, 'deactivate')}
                              >
                                <PowerOff className="h-3 w-3 mr-1" />
                                Deactivate
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Action Dialog */}
      {selectedItem && (
        <ActivationActionDialog
          open={actionDialogOpen}
          onOpenChange={setActionDialogOpen}
          {...selectedItem}
          actionType={actionType}
        />
      )}
    </div>
  );
}
