import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Database, Building2, Info, BookOpen, FileCheck, Shield, Users, Settings, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ConflictResolutionDialog } from '@/components/import/ConflictResolutionDialog';
import { CreateAccountDialog } from '@/components/admin/CreateAccountDialog';
import Papa from 'papaparse';
import type { Tables, Enums } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;
type AppRole = Enums<'app_role'>;

const ALL_ROLES: AppRole[] = ['admin', 'provider', 'physician'];

const ROLE_COLORS: Record<AppRole, string> = {
  admin: 'bg-red-100 text-red-800 border-red-200',
  provider: 'bg-blue-100 text-blue-800 border-blue-200',
  physician: 'bg-green-100 text-green-800 border-green-200',
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
  
  const [activeTab, setActiveTab] = useState(tabParam === 'roles' ? 'roles' : 'import');
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

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList>
              <TabsTrigger value="import" className="gap-2">
                <Database className="h-4 w-4" />
                Data Import
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
                <TabsList className="grid w-full grid-cols-3">
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
              </Tabs>
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
