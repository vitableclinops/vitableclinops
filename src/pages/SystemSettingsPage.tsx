import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Database, Building2, Info, BookOpen, FileCheck, Shield, Users, Settings, ArrowLeft, RefreshCw, Link2, XCircle, Clock, Activity, ChevronDown, Sliders } from 'lucide-react';
import { SlaBufferSettingCard } from '@/components/admin/SlaBufferSettingCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ConflictResolutionDialog } from '@/components/import/ConflictResolutionDialog';
import { CreateAccountDialog } from '@/components/admin/CreateAccountDialog';
import { SyncHealthCard } from '@/components/admin/SyncHealthCard';
import Papa from 'papaparse';
import type { Tables, Enums } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;
type AppRole = Enums<'app_role'>;

const ALL_ROLES: AppRole[] = ['admin', 'provider', 'physician', 'pod_lead'];

const ROLE_COLORS: Record<AppRole, string> = {
  admin: 'bg-red-100 text-red-800 border-red-200',
  provider: 'bg-blue-100 text-blue-800 border-blue-200',
  physician: 'bg-green-100 text-green-800 border-green-200',
  pod_lead: 'bg-purple-100 text-purple-800 border-purple-200',
};

interface UserWithRoles extends Profile {
  roles: AppRole[];
}

interface Conflict {
  email?: string;
  identifier?: string;
  providerName: string;
  field: string;
  fieldLabel: string;
  currentValue: any;
  newValue: any;
}

interface FieldResolution {
  email?: string;
  identifier?: string;
  field: string;
  useNew: boolean;
}

interface ImportResult {
  profilesUpserted: number;
  licensesInserted?: number;
  fieldsUpdated: number;
  fieldsFilled: number;
  conflicts: Conflict[];
  errors: string[];
}

interface SupervisionImportResult {
  agreementsCreated: number;
  agreementsUpdated: number;
  providersLinked: number;
  skipped: number;
  preview: Array<{
    providerName: string;
    physicianName: string;
    state: string;
    supervisionType: string;
    status: string;
    effectiveDate: string;
    action: 'create' | 'update' | 'skip';
    reason?: string;
  }>;
  errors: string[];
}

export default function SystemSettingsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  
  const { user, profile, roles } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState(
    tabParam === 'roles' ? 'roles' : tabParam === 'homebase' ? 'homebase' : 'import'
  );
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  
  // Import state
  const [medallionFile, setMedallionFile] = useState<File | null>(null);
  const [medallionData, setMedallionData] = useState<any[] | null>(null);
  const [medallionLoading, setMedallionLoading] = useState(false);
  const [medallionResult, setMedallionResult] = useState<ImportResult | null>(null);
  
  const [notionFile, setNotionFile] = useState<File | null>(null);
  const [notionData, setNotionData] = useState<any[] | null>(null);
  const [notionLoading, setNotionLoading] = useState(false);
  const [notionResult, setNotionResult] = useState<ImportResult | null>(null);
  
  const [supervisionsFile, setSupervisionsFile] = useState<File | null>(null);
  const [supervisionsData, setSupervisionsData] = useState<any[] | null>(null);
  const [supervisionsLoading, setSupervisionsLoading] = useState(false);
  const [supervisionsResult, setSupervisionsResult] = useState<SupervisionImportResult | null>(null);
  
  const [pendingConflicts, setPendingConflicts] = useState<Conflict[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [activeImportType, setActiveImportType] = useState<'medallion' | 'notion'>('medallion');
  
  const medallionInputRef = useRef<HTMLInputElement>(null);
  const notionInputRef = useRef<HTMLInputElement>(null);
  const supervisionsInputRef = useRef<HTMLInputElement>(null);

  // ========== SLA / Slots import state ==========
  const [slaFile, setSlaFile] = useState<File | null>(null);
  const [slaWindowLabel, setSlaWindowLabel] = useState<'feb2026_current' | 'past_2_weeks'>('past_2_weeks');
  const [slaLoading, setSlaLoading] = useState(false);
  const [slaResult, setSlaResult] = useState<{ inserted: number; errors: string[] } | null>(null);
  const slaInputRef = useRef<HTMLInputElement>(null);

  const [slotsFile, setSlotsFile] = useState<File | null>(null);
  const [slotsWindowType, setSlotsWindowType] = useState<'historical' | 'forecast'>('historical');
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsResult, setSlotsResult] = useState<{ inserted: number; errors: string[] } | null>(null);
  const slotsInputRef = useRef<HTMLInputElement>(null);

  // ========== Homebase Tab State ==========
  const [syncLoading, setSyncLoading] = useState(false);
  const [mappingSearch, setMappingSearch] = useState('');
  const [newMappingName, setNewMappingName] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [newMappingProfileId, setNewMappingProfileId] = useState('');

  const userRole = roles[0] || 'provider';
  const userName = profile?.full_name || profile?.email || 'User';
  const userEmail = profile?.email || '';

  // ========== User Roles Logic ==========
  const { data: usersWithRoles, isLoading: rolesLoading } = useQuery({
    queryKey: ['users-with-roles'],
    queryFn: async () => {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('*');

      if (rolesError) throw rolesError;

      const usersMap = new Map<string, UserWithRoles>();
      
      profiles?.forEach(profile => {
        usersMap.set(profile.user_id, { ...profile, roles: [] });
      });

      userRoles?.forEach(role => {
        const user = usersMap.get(role.user_id);
        if (user) user.roles.push(role.role as AppRole);
      });

      return Array.from(usersMap.values());
    },
  });

  const toggleRoleMutation = useMutation({
    mutationFn: async ({ userId, role, hasRole }: { userId: string; role: AppRole; hasRole: boolean }) => {
      if (hasRole) {
        const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('user_roles').insert({ user_id: userId, role });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      toast({
        title: variables.hasRole ? 'Role removed' : 'Role added',
        description: `Successfully ${variables.hasRole ? 'removed' : 'added'} ${variables.role} role.`,
      });
      setUpdatingUser(null);
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setUpdatingUser(null);
    },
  });

  const handleToggleRole = (userId: string, role: AppRole, hasRole: boolean) => {
    setUpdatingUser(`${userId}-${role}`);
    toggleRoleMutation.mutate({ userId, role, hasRole });
  };

  // ========== Homebase Logic ==========
  const { data: syncRuns, isLoading: syncRunsLoading, refetch: refetchSyncRuns } = useQuery({
    queryKey: ['homebase_sync_runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('homebase_sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: nameMappings, refetch: refetchMappings } = useQuery({
    queryKey: ['provider_name_mappings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_name_mappings')
        .select('id, homebase_name, profile_id, created_at, profiles(full_name, email)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        id: string;
        homebase_name: string;
        profile_id: string;
        created_at: string;
        profiles: { full_name: string | null; email: string | null } | null;
      }>;
    },
  });

  const { data: allProfiles } = useQuery({
    queryKey: ['all-profiles-for-mapping'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: activeTab === 'homebase',
  });

  const addMappingMutation = useMutation({
    mutationFn: async ({ homebase_name, profile_id }: { homebase_name: string; profile_id: string }) => {
      const { error } = await supabase
        .from('provider_name_mappings')
        .insert({ homebase_name, profile_id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider_name_mappings'] });
      setNewMappingName('');
      setNewMappingProfileId('');
      toast({ title: 'Mapping added' });
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteMappingMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('provider_name_mappings').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider_name_mappings'] });
      toast({ title: 'Mapping removed' });
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleTriggerSync = async () => {
    setSyncLoading(true);
    try {
      const { error } = await supabase.functions.invoke('sync-homebase');
      if (error) throw error;
      toast({ title: 'Homebase sync started', description: 'Refresh in a few seconds to see results.' });
      setTimeout(() => refetchSyncRuns(), 5000);
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e.message, variant: 'destructive' });
    } finally {
      setSyncLoading(false);
    }
  };

  const latestRun = syncRuns?.[0];
  const filteredMappings = (nameMappings ?? []).filter(
    (m) => !mappingSearch || m.homebase_name.toLowerCase().includes(mappingSearch.toLowerCase())
  );

  // ========== SLA Import ==========
  const handleSlaImport = async () => {
    if (!slaFile) return;
    setSlaLoading(true);
    setSlaResult(null);
    Papa.parse(slaFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = (results.data as any[]).map((r) => ({
            state: r['State'] ?? r['state'] ?? '',
            sla: r['SLA Attainment Rate'] ?? r['SLA'] ?? r['sla'] ?? '',
          })).filter((r) => r.state);
          const { data, error } = await supabase.functions.invoke('import-sla-attainment', {
            body: { rows, window_label: slaWindowLabel },
          });
          if (error) throw error;
          setSlaResult({ inserted: data?.inserted ?? rows.length, errors: data?.errors ?? [] });
          toast({ title: 'SLA import complete', description: `${data?.inserted ?? rows.length} rows inserted` });
        } catch (e: any) {
          toast({ title: 'SLA import failed', description: e.message, variant: 'destructive' });
        } finally {
          setSlaLoading(false);
        }
      },
    });
  };

  // ========== Slots Import ==========
  const handleSlotsImport = async () => {
    if (!slotsFile) return;
    setSlotsLoading(true);
    setSlotsResult(null);
    Papa.parse(slotsFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = (results.data as any[]).map((r) => ({
            state: r['State'] ?? r['state'] ?? '',
            date: r['Day'] ?? r['Date'] ?? r['date'] ?? '',
            slots: Number(r['Sum of same_next_day_available_slots'] ?? r['slots'] ?? r['Slots'] ?? 0),
          })).filter((r) => r.state && r.date);
          const { data, error } = await supabase.functions.invoke('import-leftover-slots', {
            body: { rows, window_type: slotsWindowType },
          });
          if (error) throw error;
          setSlotsResult({ inserted: data?.inserted ?? rows.length, errors: data?.errors ?? [] });
          toast({ title: 'Slots import complete', description: `${data?.inserted ?? rows.length} rows inserted` });
        } catch (e: any) {
          toast({ title: 'Slots import failed', description: e.message, variant: 'destructive' });
        } finally {
          setSlotsLoading(false);
        }
      },
    });
  };

  // ========== Import Logic ==========
  const handleFileSelect = (file: File, type: 'medallion' | 'notion') => {
    const setFile = type === 'medallion' ? setMedallionFile : setNotionFile;
    const setData = type === 'medallion' ? setMedallionData : setNotionData;
    const setResult = type === 'medallion' ? setMedallionResult : setNotionResult;
    
    setFile(file);
    setResult(null);
    setPendingConflicts([]);
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setData(results.data as any[]);
        toast({ title: 'File parsed', description: `Found ${results.data.length} providers in ${file.name}` });
      },
      error: (error) => {
        toast({ title: 'Parse error', description: error.message, variant: 'destructive' });
      },
    });
  };

  const runMedallionImport = async (mode: 'preview' | 'apply', resolutions: FieldResolution[] = []) => {
    if (!medallionData) return;
    setMedallionLoading(true);
    if (mode === 'preview') { setMedallionResult(null); setPendingConflicts([]); }

    try {
      const BATCH_SIZE = 5;
      const allConflicts: Conflict[] = [];
      const totalResult: ImportResult = { profilesUpserted: 0, licensesInserted: 0, fieldsUpdated: 0, fieldsFilled: 0, conflicts: [], errors: [] };

      const batches = [];
      for (let i = 0; i < medallionData.length; i += BATCH_SIZE) {
        batches.push(medallionData.slice(i, i + BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchEmails = batch.map((p: any) => p.Email?.toLowerCase().trim());
        const batchResolutions = resolutions.filter(r => r.email && batchEmails.includes(r.email));

        const { data, error } = await supabase.functions.invoke('import-medallion-providers', {
          body: { providers: batch, mode, resolutions: batchResolutions },
        });

        if (error) { totalResult.errors.push(`Batch ${i + 1} failed: ${error.message}`); continue; }

        totalResult.profilesUpserted += data.profilesUpserted || 0;
        totalResult.licensesInserted = (totalResult.licensesInserted || 0) + (data.licensesInserted || 0);
        totalResult.fieldsUpdated += data.fieldsUpdated || 0;
        totalResult.fieldsFilled += data.fieldsFilled || 0;
        if (data.conflicts?.length) allConflicts.push(...data.conflicts);
        if (data.errors?.length) totalResult.errors.push(...data.errors);
      }

      if (mode === 'preview') {
        if (allConflicts.length > 0) {
          setPendingConflicts(allConflicts);
          setActiveImportType('medallion');
          setShowConflictDialog(true);
        } else {
          await runMedallionImport('apply', []);
        }
      } else {
        setMedallionResult(totalResult);
        toast({ title: 'Import complete', description: `Updated ${totalResult.profilesUpserted} providers` });
      }
    } catch (error: any) {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
    } finally {
      setMedallionLoading(false);
    }
  };

  const runNotionImport = async (mode: 'preview' | 'apply', resolutions: FieldResolution[] = []) => {
    if (!notionData) return;
    setNotionLoading(true);
    if (mode === 'preview') { setNotionResult(null); setPendingConflicts([]); }

    try {
      const BATCH_SIZE = 5;
      const allConflicts: Conflict[] = [];
      const totalResult: ImportResult = { profilesUpserted: 0, fieldsUpdated: 0, fieldsFilled: 0, conflicts: [], errors: [] };

      const batches = [];
      for (let i = 0; i < notionData.length; i += BATCH_SIZE) {
        batches.push(notionData.slice(i, i + BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const { data, error } = await supabase.functions.invoke('import-notion-providers', {
          body: { providers: batch, mode, resolutions },
        });

        if (error) { totalResult.errors.push(`Batch ${i + 1} failed: ${error.message}`); continue; }

        totalResult.profilesUpserted += data.profilesUpserted || 0;
        totalResult.fieldsUpdated += data.fieldsUpdated || 0;
        totalResult.fieldsFilled += data.fieldsFilled || 0;
        if (data.conflicts?.length) allConflicts.push(...data.conflicts);
        if (data.errors?.length) totalResult.errors.push(...data.errors);
      }

      if (mode === 'preview') {
        if (allConflicts.length > 0) {
          setPendingConflicts(allConflicts);
          setActiveImportType('notion');
          setShowConflictDialog(true);
        } else {
          await runNotionImport('apply', []);
        }
      } else {
        setNotionResult(totalResult);
        toast({ title: 'Import complete', description: `Updated ${totalResult.profilesUpserted} providers` });
      }
    } catch (error: any) {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
    } finally {
      setNotionLoading(false);
    }
  };

  const runSupervisionsImport = async (mode: 'preview' | 'apply') => {
    if (!supervisionsData) return;
    setSupervisionsLoading(true);
    if (mode === 'preview') setSupervisionsResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('import-supervisions', {
        body: { supervisions: supervisionsData, mode },
      });

      if (error) throw error;
      setSupervisionsResult(data);
      if (mode === 'apply') {
        toast({ title: 'Import complete', description: `Created ${data.agreementsCreated} agreements` });
      }
    } catch (error: any) {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
    } finally {
      setSupervisionsLoading(false);
    }
  };

  const handleConflictResolve = (resolutions: FieldResolution[]) => {
    setShowConflictDialog(false);
    if (activeImportType === 'medallion') {
      runMedallionImport('apply', resolutions);
    } else {
      runNotionImport('apply', resolutions);
    }
  };

  const renderResultCard = (result: ImportResult, includesLicenses: boolean) => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          Import Complete
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`grid gap-4 ${includesLicenses ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3'}`}>
          <Card><CardContent className="pt-6"><div className="text-3xl font-bold text-primary">{result.profilesUpserted}</div><p className="text-sm text-muted-foreground">Providers</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-3xl font-bold text-primary">{result.fieldsFilled}</div><p className="text-sm text-muted-foreground">Fields Filled</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-3xl font-bold text-primary">{result.fieldsUpdated}</div><p className="text-sm text-muted-foreground">Fields Updated</p></CardContent></Card>
          {includesLicenses && <Card><CardContent className="pt-6"><div className="text-3xl font-bold text-primary">{result.licensesInserted || 0}</div><p className="text-sm text-muted-foreground">Licenses</p></CardContent></Card>}
        </div>
        {result.errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Errors ({result.errors.length})</AlertTitle>
            <AlertDescription>
              <ScrollArea className="h-32 mt-2">
                <ul className="list-disc pl-4 space-y-1">{result.errors.map((e, i) => <li key={i} className="text-sm">{e}</li>)}</ul>
              </ScrollArea>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen flex w-full bg-background">
      <AppSidebar userRole={userRole} userName={userName} userEmail={userEmail} userAvatarUrl={profile?.avatar_url || undefined} />
      
      <main className="flex-1 p-6 ml-16 lg:ml-64">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Settings className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">System Settings</h1>
              <p className="text-muted-foreground">Data imports, user roles, and admin utilities</p>
            </div>
          </div>

          {/* How to use guide */}
          <Collapsible open={showGuide} onOpenChange={setShowGuide}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-7 px-2 text-xs -mt-2">
                <Info className="h-3.5 w-3.5" />
                How to use this page
                <ChevronDown className={`h-3 w-3 transition-transform ${showGuide ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Alert className="bg-muted/40 border-border mb-4">
                <AlertDescription className="text-sm space-y-3">
                  <p className="font-semibold text-foreground">Purpose: the data pipeline control center — import all Metabase CSVs, manage the Homebase sync, and configure user access.</p>
                  <div className="space-y-2 text-muted-foreground">
                    <p><span className="font-medium text-foreground">Data Import tab</span> — upload CSVs for slot data and SLA attainment directly here. Use these tabs for the manual Ops Dashboard data pipeline. For the License Optimizer's full 6-file upload, go directly to the <a href="/admin/license-optimizer" className="underline text-primary">License Optimizer page</a> which auto-detects file types.</p>
                    <p><span className="font-medium text-foreground">Homebase tab</span> — trigger a manual sync or review recent sync history. The sync pulls all locations, employees, and shifts (±14 days) from the Homebase API and matches employees to provider profiles by email, then name. If providers aren't matching, add a manual name mapping in the "Provider Name Mappings" section below the sync status. After syncing, return to the License Optimizer and click "Recompute" to refresh all optimization snapshots.</p>
                    <p><span className="font-medium text-foreground">Sync status indicators</span> — green checkmark = sync completed successfully. Spinner = sync running (refresh in a few seconds). Red X = sync failed, check the error message. "Unmatched" count shows how many Homebase employees couldn't be linked to provider profiles — add mappings to fix these.</p>
                    <p><span className="font-medium text-foreground">User Roles tab</span> — assign admin, pod_lead, or provider roles. Admins see all ops tools. Pod leads see their team's tasks only.</p>
                  </div>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Weekly checklist:</span>
                    {' '}Homebase → Sync Now · wait for green checkmark · License Optimizer → Recompute · upload Metabase CSVs here (Slot Data + SLA) or via License Optimizer bulk upload.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList>
              <TabsTrigger value="import" className="gap-2">
                <Database className="h-4 w-4" />
                Data Import
              </TabsTrigger>
              <TabsTrigger value="homebase" className="gap-2">
                <Link2 className="h-4 w-4" />
                Homebase
              </TabsTrigger>
              <TabsTrigger value="roles" className="gap-2">
                <Shield className="h-4 w-4" />
                User Roles
              </TabsTrigger>
            </TabsList>

            {/* Data Import Tab */}
            <TabsContent value="import" className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Smart Merge Import</AlertTitle>
                <AlertDescription>
                  Import fills missing data without overwriting. Conflicting values prompt you to choose.
                </AlertDescription>
              </Alert>

              <Tabs defaultValue="medallion" className="space-y-4">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="medallion" className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Medallion
                  </TabsTrigger>
                  <TabsTrigger value="notion" className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Notion
                  </TabsTrigger>
                  <TabsTrigger value="supervisions" className="flex items-center gap-2">
                    <FileCheck className="h-4 w-4" />
                    Supervisions
                  </TabsTrigger>
                  <TabsTrigger value="sla" className="flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    SLA Data
                  </TabsTrigger>
                  <TabsTrigger value="slots" className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Slot Data
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="medallion" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />Medallion Provider Export</CardTitle>
                      <CardDescription>Upload comprehensive provider CSV from Medallion</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <input ref={medallionInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0], 'medallion')} />
                      
                      {medallionFile ? (
                        <div className="p-4 border rounded-lg bg-muted/50">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{medallionFile.name}</p>
                              <p className="text-sm text-muted-foreground">{medallionData?.length || 0} providers</p>
                            </div>
                            <div className="flex gap-2">
                              <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />Ready</Badge>
                              <Button variant="ghost" size="sm" onClick={() => { setMedallionFile(null); setMedallionData(null); setMedallionResult(null); }}>Remove</Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Button variant="outline" className="w-full h-32 border-dashed" onClick={() => medallionInputRef.current?.click()}>
                          <div className="flex flex-col items-center gap-2">
                            <Upload className="h-8 w-8 text-muted-foreground" />
                            <span>Click to upload Medallion CSV</span>
                          </div>
                        </Button>
                      )}

                      {medallionData && !medallionResult && (
                        <Button onClick={() => runMedallionImport('preview')} disabled={medallionLoading} className="w-full">
                          {medallionLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</> : 'Start Import'}
                        </Button>
                      )}

                      {medallionResult && renderResultCard(medallionResult, true)}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="notion" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" />Notion Provider Export</CardTitle>
                      <CardDescription>Upload provider data from Notion</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <input ref={notionInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0], 'notion')} />
                      
                      {notionFile ? (
                        <div className="p-4 border rounded-lg bg-muted/50">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{notionFile.name}</p>
                              <p className="text-sm text-muted-foreground">{notionData?.length || 0} providers</p>
                            </div>
                            <div className="flex gap-2">
                              <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />Ready</Badge>
                              <Button variant="ghost" size="sm" onClick={() => { setNotionFile(null); setNotionData(null); setNotionResult(null); }}>Remove</Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Button variant="outline" className="w-full h-32 border-dashed" onClick={() => notionInputRef.current?.click()}>
                          <div className="flex flex-col items-center gap-2">
                            <Upload className="h-8 w-8 text-muted-foreground" />
                            <span>Click to upload Notion CSV</span>
                          </div>
                        </Button>
                      )}

                      {notionData && !notionResult && (
                        <Button onClick={() => runNotionImport('preview')} disabled={notionLoading} className="w-full">
                          {notionLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</> : 'Start Import'}
                        </Button>
                      )}

                      {notionResult && renderResultCard(notionResult, false)}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="supervisions" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><FileCheck className="h-5 w-5" />Supervision Agreements</CardTitle>
                      <CardDescription>Import supervision/collaboration data</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <input ref={supervisionsInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setSupervisionsFile(file);
                          setSupervisionsResult(null);
                          Papa.parse(file, {
                            header: true, skipEmptyLines: true,
                            complete: (results) => { setSupervisionsData(results.data as any[]); toast({ title: 'File parsed', description: `Found ${results.data.length} records` }); },
                            error: (error) => { toast({ title: 'Parse error', description: error.message, variant: 'destructive' }); },
                          });
                        }
                      }} />
                      
                      {supervisionsFile ? (
                        <div className="p-4 border rounded-lg bg-muted/50">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{supervisionsFile.name}</p>
                              <p className="text-sm text-muted-foreground">{supervisionsData?.length || 0} records</p>
                            </div>
                            <div className="flex gap-2">
                              <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />Ready</Badge>
                              <Button variant="ghost" size="sm" onClick={() => { setSupervisionsFile(null); setSupervisionsData(null); setSupervisionsResult(null); }}>Remove</Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Button variant="outline" className="w-full h-32 border-dashed" onClick={() => supervisionsInputRef.current?.click()}>
                          <div className="flex flex-col items-center gap-2">
                            <Upload className="h-8 w-8 text-muted-foreground" />
                            <span>Click to upload Supervisions CSV</span>
                          </div>
                        </Button>
                      )}

                      {supervisionsData && !supervisionsResult && (
                        <Button onClick={() => runSupervisionsImport('preview')} disabled={supervisionsLoading} className="w-full">
                          {supervisionsLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</> : 'Preview Import'}
                        </Button>
                      )}

                      {supervisionsResult && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-success"><CheckCircle2 className="h-5 w-5" />Import Complete</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="grid gap-4 grid-cols-3">
                              <Card><CardContent className="pt-6"><div className="text-3xl font-bold text-primary">{supervisionsResult.agreementsCreated}</div><p className="text-sm text-muted-foreground">Created</p></CardContent></Card>
                              <Card><CardContent className="pt-6"><div className="text-3xl font-bold text-primary">{supervisionsResult.agreementsUpdated}</div><p className="text-sm text-muted-foreground">Updated</p></CardContent></Card>
                              <Card><CardContent className="pt-6"><div className="text-3xl font-bold text-primary">{supervisionsResult.providersLinked}</div><p className="text-sm text-muted-foreground">Linked</p></CardContent></Card>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* SLA Attainment */}
                <TabsContent value="sla" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Activity className="h-5 w-5" />
                        SLA Attainment Data
                      </CardTitle>
                      <CardDescription>
                        Upload Metabase SLA CSV — columns: State, SLA Attainment Rate
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Select value={slaWindowLabel} onValueChange={(v) => setSlaWindowLabel(v as any)}>
                          <SelectTrigger className="w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="past_2_weeks">Past 2 Weeks</SelectItem>
                            <SelectItem value="feb2026_current">Feb 2026 → Current</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground">window</span>
                      </div>

                      <input ref={slaInputRef} type="file" accept=".csv" className="hidden"
                        onChange={(e) => { setSlaFile(e.target.files?.[0] ?? null); setSlaResult(null); }} />

                      {slaFile ? (
                        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                          <div>
                            <p className="font-medium">{slaFile.name}</p>
                          </div>
                          <div className="flex gap-2">
                            <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />Ready</Badge>
                            <Button variant="ghost" size="sm" onClick={() => { setSlaFile(null); setSlaResult(null); }}>Remove</Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="outline" className="w-full h-24 border-dashed" onClick={() => slaInputRef.current?.click()}>
                          <div className="flex flex-col items-center gap-2">
                            <Upload className="h-6 w-6 text-muted-foreground" />
                            <span>Upload SLA attainment CSV</span>
                          </div>
                        </Button>
                      )}

                      {slaFile && !slaResult && (
                        <Button onClick={handleSlaImport} disabled={slaLoading} className="w-full">
                          {slaLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</> : 'Import SLA Data'}
                        </Button>
                      )}

                      {slaResult && (
                        <Alert variant={slaResult.errors.length > 0 ? 'destructive' : 'default'}>
                          <CheckCircle2 className="h-4 w-4" />
                          <AlertTitle>{slaResult.inserted} rows inserted</AlertTitle>
                          {slaResult.errors.length > 0 && (
                            <AlertDescription>{slaResult.errors.slice(0, 5).join(', ')}</AlertDescription>
                          )}
                        </Alert>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Leftover Slots */}
                <TabsContent value="slots" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Database className="h-5 w-5" />
                        Slot Availability Data
                      </CardTitle>
                      <CardDescription>
                        Upload Metabase leftover slots CSV — columns: State, Day, Sum of same_next_day_available_slots
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Select value={slotsWindowType} onValueChange={(v) => setSlotsWindowType(v as any)}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="historical">Historical</SelectItem>
                            <SelectItem value="forecast">Forecast</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground">window type</span>
                      </div>

                      <input ref={slotsInputRef} type="file" accept=".csv" className="hidden"
                        onChange={(e) => { setSlotsFile(e.target.files?.[0] ?? null); setSlotsResult(null); }} />

                      {slotsFile ? (
                        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                          <div>
                            <p className="font-medium">{slotsFile.name}</p>
                          </div>
                          <div className="flex gap-2">
                            <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />Ready</Badge>
                            <Button variant="ghost" size="sm" onClick={() => { setSlotsFile(null); setSlotsResult(null); }}>Remove</Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="outline" className="w-full h-24 border-dashed" onClick={() => slotsInputRef.current?.click()}>
                          <div className="flex flex-col items-center gap-2">
                            <Upload className="h-6 w-6 text-muted-foreground" />
                            <span>Upload slot availability CSV</span>
                          </div>
                        </Button>
                      )}

                      {slotsFile && !slotsResult && (
                        <Button onClick={handleSlotsImport} disabled={slotsLoading} className="w-full">
                          {slotsLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</> : 'Import Slot Data'}
                        </Button>
                      )}

                      {slotsResult && (
                        <Alert variant={slotsResult.errors.length > 0 ? 'destructive' : 'default'}>
                          <CheckCircle2 className="h-4 w-4" />
                          <AlertTitle>{slotsResult.inserted} rows inserted</AlertTitle>
                          {slotsResult.errors.length > 0 && (
                            <AlertDescription>{slotsResult.errors.slice(0, 5).join(', ')}</AlertDescription>
                          )}
                        </Alert>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

              </Tabs>
            </TabsContent>

            {/* Homebase Tab */}
            <TabsContent value="homebase" className="space-y-6">

              {/* Sync status card */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle className="text-base">Homebase Sync</CardTitle>
                    <CardDescription>Pulls employees, shifts, and locations from Homebase API.</CardDescription>
                  </div>
                  <Button onClick={handleTriggerSync} disabled={syncLoading} size="sm" className="gap-2">
                    {syncLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {syncLoading ? 'Syncing…' : 'Sync Now'}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {latestRun && (
                    <div className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        {latestRun.status === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                        {latestRun.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                        {latestRun.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                        <span className="font-medium capitalize">{latestRun.status}</span>
                        <span className="text-sm text-muted-foreground ml-auto">
                          {new Date(latestRun.started_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                        {[
                          { label: 'Locations', val: latestRun.locations_synced },
                          { label: 'Employees', val: latestRun.employees_synced },
                          { label: 'Matched', val: latestRun.employees_matched },
                          { label: 'Unmatched', val: latestRun.employees_unmatched },
                        ].map(({ label, val }) => (
                          <div key={label} className="rounded bg-muted px-3 py-2">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="text-lg font-semibold">{val ?? '—'}</p>
                          </div>
                        ))}
                      </div>
                      {latestRun.shifts_synced !== null && (
                        <p className="text-sm text-muted-foreground">
                          Shifts synced: <span className="font-medium text-foreground">{latestRun.shifts_synced}</span>
                        </p>
                      )}
                      {latestRun.error && (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Sync error</AlertTitle>
                          <AlertDescription>{latestRun.error}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}

                  {/* Sync history */}
                  {syncRunsLoading ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                  ) : (syncRuns ?? []).length > 1 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recent runs</p>
                      <div className="space-y-1">
                        {(syncRuns ?? []).slice(1).map((run) => (
                          <div key={run.id} className="flex items-center gap-3 text-sm px-1 py-1">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground w-36 shrink-0">
                              {new Date(run.started_at).toLocaleString()}
                            </span>
                            <Badge
                              variant={run.status === 'success' ? 'default' : run.status === 'error' ? 'destructive' : 'secondary'}
                              className="capitalize text-xs"
                            >
                              {run.status}
                            </Badge>
                            <span className="text-muted-foreground">
                              {run.employees_synced ?? 0} employees · {run.shifts_synced ?? 0} shifts
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Provider name mappings */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Provider Name Mappings</CardTitle>
                  <CardDescription>
                    Map Homebase employee names to provider profiles when automatic matching fails.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Add new mapping */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <Input
                      placeholder="Homebase display name (exact)"
                      value={newMappingName}
                      onChange={(e) => setNewMappingName(e.target.value)}
                    />
                    <Select value={newMappingProfileId} onValueChange={setNewMappingProfileId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(allProfiles ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.full_name || p.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => addMappingMutation.mutate({ homebase_name: newMappingName.trim(), profile_id: newMappingProfileId })}
                      disabled={!newMappingName.trim() || !newMappingProfileId || addMappingMutation.isPending}
                      size="sm"
                    >
                      {addMappingMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                    </Button>
                  </div>

                  {/* Search existing */}
                  <Input
                    placeholder="Search mappings…"
                    value={mappingSearch}
                    onChange={(e) => setMappingSearch(e.target.value)}
                    className="max-w-xs"
                  />

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Homebase Name</TableHead>
                        <TableHead>Mapped Provider</TableHead>
                        <TableHead>Added</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMappings.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                            No mappings yet
                          </TableCell>
                        </TableRow>
                      ) : filteredMappings.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">{m.homebase_name}</TableCell>
                          <TableCell>{m.profiles?.full_name ?? m.profiles?.email ?? m.profile_id}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(m.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteMappingMutation.mutate(m.id)}
                              disabled={deleteMappingMutation.isPending}
                            >
                              <XCircle className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* User Roles Tab */}
            <TabsContent value="roles" className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    All Users
                  </h2>
                  <p className="text-sm text-muted-foreground">Check/uncheck roles to grant or revoke access</p>
                </div>
                <CreateAccountDialog />
              </div>

              <Card>
                <CardContent className="p-0">
                  {rolesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : !usersWithRoles?.length ? (
                    <div className="text-center py-8 text-muted-foreground">No users found.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Current Roles</TableHead>
                          {ALL_ROLES.map(role => (
                            <TableHead key={role} className="text-center capitalize">{role}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usersWithRoles.map(user => (
                          <TableRow key={user.id}>
                            <TableCell className="font-medium">{user.full_name || 'No name'}</TableCell>
                            <TableCell className="text-muted-foreground">{user.email}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {user.roles.length > 0 ? user.roles.map(role => (
                                  <Badge key={role} variant="outline" className={ROLE_COLORS[role]}>{role}</Badge>
                                )) : <span className="text-muted-foreground text-sm">No roles</span>}
                              </div>
                            </TableCell>
                            {ALL_ROLES.map(role => {
                              const hasRole = user.roles.includes(role);
                              const isUpdating = updatingUser === `${user.user_id}-${role}`;
                              return (
                                <TableCell key={role} className="text-center">
                                  {isUpdating ? (
                                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                                  ) : (
                                    <Checkbox
                                      checked={hasRole}
                                      onCheckedChange={() => handleToggleRole(user.user_id, role, hasRole)}
                                    />
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Capacity & SLA Tab */}
            <TabsContent value="capacity" className="space-y-6">
              <SlaBufferSettingCard />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <ConflictResolutionDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        conflicts={pendingConflicts}
        onResolve={handleConflictResolve}
        onCancel={() => { setShowConflictDialog(false); setPendingConflicts([]); }}
      />
    </div>
  );
}
