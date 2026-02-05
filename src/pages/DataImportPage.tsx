import { useState, useRef } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Database, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import Papa from 'papaparse';

interface ImportResult {
  success: boolean;
  dryRun: boolean;
  results: {
    providersProcessed: number;
    providersInserted: number;
    providersUpdated: number;
    licensesProcessed: number;
    licensesInserted: number;
    errors: string[];
    providers: Array<{
      email: string;
      profileData: Record<string, any>;
      licenseCount: number;
      activeStates: string[];
      collabStates: string[];
    }>;
  };
}

export default function DataImportPage() {
  const { user, roles } = useAuth();
  const { toast } = useToast();
  
  const [directoryFile, setDirectoryFile] = useState<File | null>(null);
  const [rosterFile, setRosterFile] = useState<File | null>(null);
  const [directoryData, setDirectoryData] = useState<any[] | null>(null);
  const [rosterData, setRosterData] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [activeTab, setActiveTab] = useState('upload');
  
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const rosterInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File, type: 'directory' | 'roster') => {
    if (type === 'directory') {
      setDirectoryFile(file);
    } else {
      setRosterFile(file);
    }
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (type === 'directory') {
          setDirectoryData(results.data as any[]);
        } else {
          setRosterData(results.data as any[]);
        }
        toast({
          title: 'File parsed',
          description: `Found ${results.data.length} rows in ${file.name}`,
        });
      },
      error: (error) => {
        toast({
          title: 'Parse error',
          description: error.message,
          variant: 'destructive',
        });
      },
    });
  };

  const runImport = async (dryRun: boolean) => {
    if (!directoryData && !rosterData) {
      toast({
        title: 'No data',
        description: 'Please upload at least one CSV file',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setImportResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('import-providers', {
        body: {
          directoryData,
          rosterData,
          dryRun,
        },
      });

      if (error) throw error;

      setImportResult(data as ImportResult);
      setActiveTab('results');
      
      toast({
        title: dryRun ? 'Preview complete' : 'Import complete',
        description: dryRun 
          ? `Found ${data.results.providersProcessed} providers to import`
          : `Imported ${data.results.providersInserted} new providers, updated ${data.results.providersUpdated}`,
      });
    } catch (error: any) {
      toast({
        title: 'Import failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar 
          userRole={roles.includes('admin') ? 'admin' : 'provider'} 
          userName={user?.email?.split('@')[0] || 'User'}
          userEmail={user?.email || ''}
        />
        
        <main className="flex-1 p-6 ml-16 lg:ml-64">
          <div className="max-w-6xl mx-auto space-y-6">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Database className="h-8 w-8 text-primary" />
                Provider Data Import
              </h1>
              <p className="text-muted-foreground mt-1">
                Import provider data from CSV files into the directory
              </p>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="upload">Upload Files</TabsTrigger>
                <TabsTrigger value="results" disabled={!importResult}>
                  Results {importResult && `(${importResult.results.providersProcessed})`}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Directory CSV */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5" />
                        Provider Directory CSV
                      </CardTitle>
                      <CardDescription>
                        Notion export with contacts, services, collab agreements
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <input
                        ref={directoryInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0], 'directory')}
                      />
                      
                      {directoryFile ? (
                        <div className="p-4 border rounded-lg bg-muted/50">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{directoryFile.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {directoryData?.length || 0} rows parsed
                              </p>
                            </div>
                            <Badge variant="secondary">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Ready
                            </Badge>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          className="w-full h-24 border-dashed"
                          onClick={() => directoryInputRef.current?.click()}
                        >
                          <Upload className="h-6 w-6 mr-2" />
                          Select Directory CSV
                        </Button>
                      )}
                    </CardContent>
                  </Card>

                  {/* Roster CSV */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5" />
                        Provider Roster CSV
                      </CardTitle>
                      <CardDescription>
                        Credentialing export with licenses, NPIs, CAQH numbers
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <input
                        ref={rosterInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0], 'roster')}
                      />
                      
                      {rosterFile ? (
                        <div className="p-4 border rounded-lg bg-muted/50">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{rosterFile.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {rosterData?.length || 0} rows parsed
                              </p>
                            </div>
                            <Badge variant="secondary">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Ready
                            </Badge>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          className="w-full h-24 border-dashed"
                          onClick={() => rosterInputRef.current?.click()}
                        >
                          <Upload className="h-6 w-6 mr-2" />
                          Select Roster CSV
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Data Merge Logic</AlertTitle>
                  <AlertDescription>
                    Providers are matched by Vitable email address. Directory data provides contact info, 
                    hire dates, and collab agreement states. Roster data provides detailed license info with 
                    numbers and expiration dates. Both sources are merged into unified profiles.
                  </AlertDescription>
                </Alert>

                <div className="flex gap-4">
                  <Button
                    onClick={() => runImport(true)}
                    disabled={isLoading || (!directoryData && !rosterData)}
                    variant="outline"
                    className="flex-1"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Users className="h-4 w-4 mr-2" />
                    )}
                    Preview Import (Dry Run)
                  </Button>
                  
                  <Button
                    onClick={() => runImport(false)}
                    disabled={isLoading || (!directoryData && !rosterData)}
                    className="flex-1"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Database className="h-4 w-4 mr-2" />
                    )}
                    Run Import
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="results">
                {importResult && (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="grid gap-4 md:grid-cols-4">
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">{importResult.results.providersProcessed}</div>
                          <p className="text-sm text-muted-foreground">Providers Processed</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold text-success">{importResult.results.providersInserted}</div>
                          <p className="text-sm text-muted-foreground">New Providers</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold text-warning">{importResult.results.providersUpdated}</div>
                          <p className="text-sm text-muted-foreground">Updated Providers</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">{importResult.results.licensesInserted}</div>
                          <p className="text-sm text-muted-foreground">Licenses Added</p>
                        </CardContent>
                      </Card>
                    </div>

                    {importResult.dryRun && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Dry Run Mode</AlertTitle>
                        <AlertDescription>
                          No data was written. Review the results below, then click "Run Import" to execute.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Errors */}
                    {importResult.results.errors.length > 0 && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Errors ({importResult.results.errors.length})</AlertTitle>
                        <AlertDescription>
                          <ScrollArea className="h-32 mt-2">
                            <ul className="list-disc pl-4 space-y-1">
                              {importResult.results.errors.map((error, i) => (
                                <li key={i} className="text-sm">{error}</li>
                              ))}
                            </ul>
                          </ScrollArea>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Provider List */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Provider Details</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[400px]">
                          <div className="space-y-2">
                            {importResult.results.providers.map((provider, i) => (
                              <div key={i} className="p-3 border rounded-lg">
                                <div className="flex items-start justify-between">
                                  <div>
                                    <p className="font-medium">{provider.profileData.full_name || provider.email}</p>
                                    <p className="text-sm text-muted-foreground">{provider.email}</p>
                                  </div>
                                  <div className="flex gap-2">
                                    {provider.profileData.credentials && (
                                      <Badge>{provider.profileData.credentials}</Badge>
                                    )}
                                    {provider.licenseCount > 0 && (
                                      <Badge variant="secondary">{provider.licenseCount} licenses</Badge>
                                    )}
                                  </div>
                                </div>
                                {provider.activeStates.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {provider.activeStates.map(state => (
                                      <Badge key={state} variant="outline" className="text-xs">
                                        {state}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
