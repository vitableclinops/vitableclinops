import { useState, useRef } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Database, Users, Building2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import Papa from 'papaparse';

interface MedallionResult {
  profilesUpserted: number;
  licensesInserted: number;
  errors: string[];
}

export default function DataImportPage() {
  const { user, roles } = useAuth();
  const { toast } = useToast();
  
  const [medallionFile, setMedallionFile] = useState<File | null>(null);
  const [medallionData, setMedallionData] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [medallionResult, setMedallionResult] = useState<MedallionResult | null>(null);
  
  const medallionInputRef = useRef<HTMLInputElement>(null);

  const handleMedallionFileSelect = (file: File) => {
    setMedallionFile(file);
    
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

  const runMedallionImport = async () => {
    if (!medallionData) {
      toast({
        title: 'No data',
        description: 'Please upload a Medallion CSV file',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setMedallionResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('import-medallion-providers', {
        body: { providers: medallionData },
      });

      if (error) throw error;

      setMedallionResult(data as MedallionResult);
      
      toast({
        title: 'Import complete',
        description: `Updated ${data.profilesUpserted} providers, added ${data.licensesInserted} licenses`,
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
                  onClick={runMedallionImport}
                  disabled={isLoading || !medallionData}
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Database className="h-4 w-4 mr-2" />
                  )}
                  Import Providers
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
                  <div className="grid gap-4 grid-cols-2">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-3xl font-bold text-primary">{medallionResult.profilesUpserted}</div>
                        <p className="text-sm text-muted-foreground">Providers Updated</p>
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
    </SidebarProvider>
  );
}
