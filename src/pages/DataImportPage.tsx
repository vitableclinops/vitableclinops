import { useState, useRef } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Database, Building2, Info } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ConflictResolutionDialog } from '@/components/import/ConflictResolutionDialog';
import Papa from 'papaparse';

interface Conflict {
  email: string;
  providerName: string;
  field: string;
  fieldLabel: string;
  currentValue: any;
  newValue: any;
}

interface FieldResolution {
  email: string;
  field: string;
  useNew: boolean;
}

interface MedallionResult {
  profilesUpserted: number;
  licensesInserted: number;
  fieldsUpdated: number;
  fieldsFilled: number;
  conflicts: Conflict[];
  errors: string[];
}

export default function DataImportPage() {
  const { user, roles } = useAuth();
  const { toast } = useToast();
  
  const [medallionFile, setMedallionFile] = useState<File | null>(null);
  const [medallionData, setMedallionData] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [medallionResult, setMedallionResult] = useState<MedallionResult | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<Conflict[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  
  const medallionInputRef = useRef<HTMLInputElement>(null);

  const handleMedallionFileSelect = (file: File) => {
    setMedallionFile(file);
    setMedallionResult(null);
    setPendingConflicts([]);
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setMedallionData(results.data as any[]);
        toast({
          title: 'File parsed',
          description: `Found ${results.data.length} providers in ${file.name}`,
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

  const runPreviewImport = async () => {
    if (!medallionData) {
      toast({
        title: 'No data',
        description: 'Please upload a CSV file',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setMedallionResult(null);
    setPendingConflicts([]);

    try {
      const BATCH_SIZE = 5;
      const allConflicts: Conflict[] = [];
      const totalResult: MedallionResult = {
        profilesUpserted: 0,
        licensesInserted: 0,
        fieldsUpdated: 0,
        fieldsFilled: 0,
        conflicts: [],
        errors: [],
      };

      const batches = [];
      for (let i = 0; i < medallionData.length; i += BATCH_SIZE) {
        batches.push(medallionData.slice(i, i + BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        toast({
          title: `Analyzing batch ${i + 1}/${batches.length}`,
          description: `Checking ${batch.length} providers for conflicts...`,
        });

        const { data, error } = await supabase.functions.invoke('import-medallion-providers', {
          body: { providers: batch, mode: 'preview' },
        });

        if (error) {
          totalResult.errors.push(`Batch ${i + 1} failed: ${error.message}`);
          continue;
        }

        totalResult.profilesUpserted += data.profilesUpserted || 0;
        totalResult.fieldsFilled += data.fieldsFilled || 0;
        if (data.conflicts?.length) {
          allConflicts.push(...data.conflicts);
        }
        if (data.errors?.length) {
          totalResult.errors.push(...data.errors);
        }
      }

      if (allConflicts.length > 0) {
        setPendingConflicts(allConflicts);
        setShowConflictDialog(true);
        toast({
          title: 'Conflicts found',
          description: `${allConflicts.length} fields have different values. Please review.`,
        });
      } else {
        // No conflicts - proceed with apply
        await runApplyImport([]);
      }
    } catch (error: any) {
      toast({
        title: 'Preview failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const runApplyImport = async (resolutions: FieldResolution[]) => {
    if (!medallionData) return;

    setIsLoading(true);
    setShowConflictDialog(false);

    try {
      const BATCH_SIZE = 5;
      const totalResult: MedallionResult = {
        profilesUpserted: 0,
        licensesInserted: 0,
        fieldsUpdated: 0,
        fieldsFilled: 0,
        conflicts: [],
        errors: [],
      };

      const batches = [];
      for (let i = 0; i < medallionData.length; i += BATCH_SIZE) {
        batches.push(medallionData.slice(i, i + BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        // Filter resolutions for this batch
        const batchEmails = batch.map((p: any) => p.Email?.toLowerCase().trim());
        const batchResolutions = resolutions.filter(r => batchEmails.includes(r.email));

        toast({
          title: `Processing batch ${i + 1}/${batches.length}`,
          description: `Importing ${batch.length} providers...`,
        });

        const { data, error } = await supabase.functions.invoke('import-medallion-providers', {
          body: { providers: batch, mode: 'apply', resolutions: batchResolutions },
        });

        if (error) {
          totalResult.errors.push(`Batch ${i + 1} failed: ${error.message}`);
          continue;
        }

        totalResult.profilesUpserted += data.profilesUpserted || 0;
        totalResult.licensesInserted += data.licensesInserted || 0;
        totalResult.fieldsUpdated += data.fieldsUpdated || 0;
        totalResult.fieldsFilled += data.fieldsFilled || 0;
        if (data.errors?.length) {
          totalResult.errors.push(...data.errors);
        }
      }

      setMedallionResult(totalResult);
      setPendingConflicts([]);
      
      toast({
        title: 'Import complete',
        description: `Updated ${totalResult.profilesUpserted} providers, filled ${totalResult.fieldsFilled} fields, added ${totalResult.licensesInserted} licenses`,
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

  const handleConflictResolve = (resolutions: FieldResolution[]) => {
    runApplyImport(resolutions);
  };

  const handleConflictCancel = () => {
    setShowConflictDialog(false);
    setPendingConflicts([]);
    toast({
      title: 'Import cancelled',
      description: 'No changes were made.',
    });
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
          <div className="max-w-4xl mx-auto space-y-6">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Database className="h-8 w-8 text-primary" />
                Provider Data Import
              </h1>
              <p className="text-muted-foreground mt-1">
                Import provider data from Medallion CSV exports
              </p>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Smart Merge Import</AlertTitle>
              <AlertDescription>
                This import will fill in missing data without overwriting existing values. 
                If there are conflicting values, you'll be prompted to choose which to keep.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Medallion Provider Export
                </CardTitle>
                <CardDescription>
                  Upload the comprehensive provider CSV from Medallion with licenses, contact info, and credentials
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <input
                  ref={medallionInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleMedallionFileSelect(e.target.files[0])}
                />
                
                {medallionFile ? (
                  <div className="p-4 border rounded-lg bg-muted/50">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{medallionFile.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {medallionData?.length || 0} providers found
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="secondary">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Ready
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setMedallionFile(null);
                            setMedallionData(null);
                            setMedallionResult(null);
                            setPendingConflicts([]);
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full h-24 border-dashed"
                    onClick={() => medallionInputRef.current?.click()}
                  >
                    <Upload className="h-6 w-6 mr-2" />
                    Select Medallion CSV
                  </Button>
                )}

                <Alert>
                  <FileSpreadsheet className="h-4 w-4" />
                  <AlertTitle>Expected Columns</AlertTitle>
                  <AlertDescription className="text-xs">
                    Full name, Email, First Name, Last Name, Preferred Name, Profession, NPI, Licenses, 
                    Actively licensed states, Primary Specialty, CAQH Number, Primary Phone, Date Of Birth, Address fields...
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={runPreviewImport}
                  disabled={isLoading || !medallionData}
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Database className="h-4 w-4 mr-2" />
                  )}
                  {isLoading ? 'Processing...' : 'Import Providers'}
                </Button>
              </CardContent>
            </Card>

            {/* Results */}
            {medallionResult && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="h-5 w-5" />
                    Import Complete
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-3xl font-bold text-primary">{medallionResult.profilesUpserted}</div>
                        <p className="text-sm text-muted-foreground">Providers Processed</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-3xl font-bold text-primary">{medallionResult.fieldsFilled}</div>
                        <p className="text-sm text-muted-foreground">Fields Filled</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-3xl font-bold text-primary">{medallionResult.fieldsUpdated}</div>
                        <p className="text-sm text-muted-foreground">Fields Updated</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-3xl font-bold text-primary">{medallionResult.licensesInserted}</div>
                        <p className="text-sm text-muted-foreground">Licenses Added</p>
                      </CardContent>
                    </Card>
                  </div>

                  {medallionResult.errors.length > 0 && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Errors ({medallionResult.errors.length})</AlertTitle>
                      <AlertDescription>
                        <ScrollArea className="h-32 mt-2">
                          <ul className="list-disc pl-4 space-y-1">
                            {medallionResult.errors.map((error, i) => (
                              <li key={i} className="text-sm">{error}</li>
                            ))}
                          </ul>
                        </ScrollArea>
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>

      <ConflictResolutionDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        conflicts={pendingConflicts}
        onResolve={handleConflictResolve}
        onCancel={handleConflictCancel}
      />
    </SidebarProvider>
  );
}
