import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Download,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { State, DemandTag, CollabRequirements } from '@/types';

interface StateImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (states: Partial<State>[]) => void;
  existingStates: State[];
}

interface ParsedRow {
  data: Partial<State>;
  errors: string[];
  warnings: string[];
  isNew: boolean;
  rowNumber: number;
}

const EXPECTED_HEADERS = [
  'State',
  'Abbreviation',
  'Demand Tag',
  'Has FPA',
  'Requires Collaborative Agreement',
  'Meeting Cadence',
  'Chart Review Required',
  'Requires Prescriptive Authority',
  'Min Application Fee',
  'Max Application Fee',
  'Min Processing Weeks',
  'Max Processing Weeks'
];

export function StateImportDialog({ 
  open, 
  onOpenChange, 
  onImport,
  existingStates 
}: StateImportDialogProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'complete'>('upload');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setStep('upload');
    setParsedRows([]);
    setFileName('');
    setIsProcessing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const parseCSV = (content: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (insideQuotes) {
        if (char === '"' && nextChar === '"') {
          currentCell += '"';
          i++;
        } else if (char === '"') {
          insideQuotes = false;
        } else {
          currentCell += char;
        }
      } else {
        if (char === '"') {
          insideQuotes = true;
        } else if (char === ',') {
          currentRow.push(currentCell.trim());
          currentCell = '';
        } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
          currentRow.push(currentCell.trim());
          if (currentRow.some(cell => cell !== '')) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = '';
          if (char === '\r') i++;
        } else {
          currentCell += char;
        }
      }
    }
    
    // Push last row
    currentRow.push(currentCell.trim());
    if (currentRow.some(cell => cell !== '')) {
      rows.push(currentRow);
    }

    return rows;
  };

  const validateAndParseRow = (row: string[], rowNumber: number): ParsedRow => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const [
      name,
      abbreviation,
      demandTag,
      hasFPA,
      requiresCA,
      meetingCadence,
      chartReviewRequired,
      requiresPrescriptive,
      minFee,
      maxFee,
      minWeeks,
      maxWeeks
    ] = row;

    // Required fields
    if (!name?.trim()) errors.push('State name is required');
    if (!abbreviation?.trim()) errors.push('Abbreviation is required');
    if (abbreviation && abbreviation.length !== 2) errors.push('Abbreviation must be 2 characters');

    // Validate demand tag
    const validDemandTags: DemandTag[] = ['critical', 'at_risk', 'watch', 'stable'];
    const parsedDemandTag = demandTag?.toLowerCase().replace(' ', '_') as DemandTag;
    if (demandTag && !validDemandTags.includes(parsedDemandTag)) {
      warnings.push(`Invalid demand tag "${demandTag}", will be ignored`);
    }

    // Validate boolean fields
    const parseBoolean = (val: string): boolean => {
      return ['yes', 'true', '1', 'y'].includes(val?.toLowerCase() || '');
    };

    // Validate meeting cadence
    const validCadences = ['weekly', 'biweekly', 'monthly', 'quarterly'];
    const parsedCadence = meetingCadence?.toLowerCase();
    if (meetingCadence && !validCadences.includes(parsedCadence)) {
      warnings.push(`Invalid meeting cadence "${meetingCadence}", defaulting to monthly`);
    }

    // Validate numbers
    const parsedMinFee = parseInt(minFee) || 0;
    const parsedMaxFee = parseInt(maxFee) || 0;
    const parsedMinWeeks = parseInt(minWeeks) || 0;
    const parsedMaxWeeks = parseInt(maxWeeks) || 0;

    if (parsedMinFee > parsedMaxFee && parsedMaxFee > 0) {
      warnings.push('Min fee is greater than max fee');
    }
    if (parsedMinWeeks > parsedMaxWeeks && parsedMaxWeeks > 0) {
      warnings.push('Min weeks is greater than max weeks');
    }

    // Check if state exists
    const existingState = existingStates.find(
      s => s.abbreviation.toLowerCase() === abbreviation?.toLowerCase()
    );

    const collabRequirements: CollabRequirements | undefined = parseBoolean(requiresCA) ? {
      meetingCadence: (validCadences.includes(parsedCadence) ? parsedCadence : 'monthly') as CollabRequirements['meetingCadence'],
      chartReviewRequired: parseBoolean(chartReviewRequired),
      chartReviewFrequency: parseBoolean(chartReviewRequired) ? 'Quarterly' : undefined,
      supervisoryActivities: []
    } : undefined;

    const stateData: Partial<State> = {
      id: existingState?.id || `state-${abbreviation?.toLowerCase()}`,
      name: name?.trim(),
      abbreviation: abbreviation?.toUpperCase().trim(),
      demandTag: validDemandTags.includes(parsedDemandTag) ? parsedDemandTag : undefined,
      hasFPA: parseBoolean(hasFPA),
      fpaApplicationRequired: parseBoolean(hasFPA),
      requiresCollaborativeAgreement: parseBoolean(requiresCA),
      collaborativeAgreementRequirements: collabRequirements,
      requiresPrescriptiveAuthority: parseBoolean(requiresPrescriptive),
      applicationFeeRange: {
        min: parsedMinFee,
        max: parsedMaxFee || parsedMinFee
      },
      processingTimeWeeks: {
        min: parsedMinWeeks,
        max: parsedMaxWeeks || parsedMinWeeks
      }
    };

    return {
      data: stateData,
      errors,
      warnings,
      isNew: !existingState,
      rowNumber
    };
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsProcessing(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const rows = parseCSV(content);
        
        if (rows.length < 2) {
          setParsedRows([{
            data: {},
            errors: ['CSV file must have at least a header row and one data row'],
            warnings: [],
            isNew: false,
            rowNumber: 0
          }]);
          setStep('preview');
          setIsProcessing(false);
          return;
        }

        // Validate headers
        const headers = rows[0];
        const missingHeaders = EXPECTED_HEADERS.filter(
          h => !headers.some(header => header.toLowerCase() === h.toLowerCase())
        );
        
        if (missingHeaders.length > 0) {
          setParsedRows([{
            data: {},
            errors: [`Missing required columns: ${missingHeaders.join(', ')}`],
            warnings: [],
            isNew: false,
            rowNumber: 0
          }]);
          setStep('preview');
          setIsProcessing(false);
          return;
        }

        // Parse data rows
        const dataRows = rows.slice(1);
        const parsed = dataRows.map((row, index) => validateAndParseRow(row, index + 2));
        
        setParsedRows(parsed);
        setStep('preview');
      } catch (error) {
        setParsedRows([{
          data: {},
          errors: ['Failed to parse CSV file. Please check the format.'],
          warnings: [],
          isNew: false,
          rowNumber: 0
        }]);
        setStep('preview');
      }
      setIsProcessing(false);
    };

    reader.onerror = () => {
      setParsedRows([{
        data: {},
        errors: ['Failed to read file'],
        warnings: [],
        isNew: false,
        rowNumber: 0
      }]);
      setStep('preview');
      setIsProcessing(false);
    };

    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const csvContent = [
      EXPECTED_HEADERS.join(','),
      '"California","CA","critical","No","Yes","quarterly","Yes","Yes","150","300","8","16"',
      '"Texas","TX","at_risk","No","Yes","monthly","Yes","Yes","186","250","6","12"',
      '"Arizona","AZ","stable","Yes","No","","No","No","100","200","4","8"'
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'state-import-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImport = () => {
    const validRows = parsedRows.filter(row => row.errors.length === 0);
    const statesToImport = validRows.map(row => row.data);
    onImport(statesToImport);
    setStep('complete');
  };

  const validRows = parsedRows.filter(row => row.errors.length === 0);
  const errorRows = parsedRows.filter(row => row.errors.length > 0);
  const warningRows = parsedRows.filter(row => row.warnings.length > 0 && row.errors.length === 0);
  const newStates = validRows.filter(row => row.isNew);
  const updatedStates = validRows.filter(row => !row.isNew);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Import State Data'}
            {step === 'preview' && 'Review Import'}
            {step === 'complete' && 'Import Complete'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a CSV file to bulk update state regulatory data.'}
            {step === 'preview' && 'Review the data before importing.'}
            {step === 'complete' && 'State data has been imported successfully.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-6 py-4">
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                'hover:border-primary hover:bg-primary/5'
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              {isProcessing ? (
                <Loader2 className="h-12 w-12 mx-auto text-muted-foreground animate-spin" />
              ) : (
                <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
              )}
              <p className="mt-4 text-sm font-medium">
                {isProcessing ? 'Processing...' : 'Click to upload or drag and drop'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">CSV files only</p>
            </div>

            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Need a template?</p>
                  <p className="text-xs text-muted-foreground">
                    Download a sample CSV with the correct format
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Template
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4 py-4">
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-2xl font-bold">{parsedRows.length}</p>
                <p className="text-xs text-muted-foreground">Total Rows</p>
              </div>
              <div className="p-3 bg-success/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-success">{validRows.length}</p>
                <p className="text-xs text-muted-foreground">Valid</p>
              </div>
              <div className="p-3 bg-warning/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-warning">{warningRows.length}</p>
                <p className="text-xs text-muted-foreground">Warnings</p>
              </div>
              <div className="p-3 bg-destructive/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-destructive">{errorRows.length}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>

            {/* Action summary */}
            {validRows.length > 0 && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  This import will add <strong>{newStates.length}</strong> new states and 
                  update <strong>{updatedStates.length}</strong> existing states.
                </AlertDescription>
              </Alert>
            )}

            {/* Scrollable list */}
            <ScrollArea className="h-[300px] border rounded-lg">
              <div className="p-4 space-y-3">
                {parsedRows.map((row, index) => (
                  <div
                    key={index}
                    className={cn(
                      'p-3 rounded-lg border',
                      row.errors.length > 0 && 'border-destructive/50 bg-destructive/5',
                      row.errors.length === 0 && row.warnings.length > 0 && 'border-warning/50 bg-warning/5',
                      row.errors.length === 0 && row.warnings.length === 0 && 'border-border'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {row.errors.length > 0 ? (
                          <XCircle className="h-4 w-4 text-destructive shrink-0" />
                        ) : row.warnings.length > 0 ? (
                          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        )}
                        <span className="font-medium">
                          {row.data.name || `Row ${row.rowNumber}`}
                        </span>
                        {row.data.abbreviation && (
                          <Badge variant="secondary" className="text-xs">
                            {row.data.abbreviation}
                          </Badge>
                        )}
                        {row.isNew && row.errors.length === 0 && (
                          <Badge className="text-xs bg-primary/10 text-primary border-0">New</Badge>
                        )}
                        {!row.isNew && row.errors.length === 0 && (
                          <Badge variant="outline" className="text-xs">Update</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">Row {row.rowNumber}</span>
                    </div>
                    {(row.errors.length > 0 || row.warnings.length > 0) && (
                      <div className="mt-2 space-y-1">
                        {row.errors.map((error, i) => (
                          <p key={i} className="text-xs text-destructive">{error}</p>
                        ))}
                        {row.warnings.map((warning, i) => (
                          <p key={i} className="text-xs text-warning">{warning}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {step === 'complete' && (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-16 w-16 mx-auto text-success" />
            <p className="mt-4 text-lg font-medium">Import Successful!</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {newStates.length} new states added, {updatedStates.length} states updated.
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={resetState}>
                Back
              </Button>
              <Button 
                onClick={handleImport}
                disabled={validRows.length === 0}
              >
                Import {validRows.length} States
              </Button>
            </>
          )}
          {step === 'complete' && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}