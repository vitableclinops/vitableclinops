import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Check, Database, FileSpreadsheet } from 'lucide-react';

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

interface ConflictResolutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: Conflict[];
  onResolve: (resolutions: FieldResolution[]) => void;
  onCancel: () => void;
}

export function ConflictResolutionDialog({
  open,
  onOpenChange,
  conflicts,
  onResolve,
  onCancel,
}: ConflictResolutionDialogProps) {
  const [resolutions, setResolutions] = useState<Record<string, boolean>>({});

  // Reset resolutions when conflicts change
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    conflicts.forEach((c) => {
      const key = c.identifier || c.email || '';
      initial[`${key}:${c.field}`] = false; // Default: keep current
    });
    setResolutions(initial);
  }, [conflicts]);

  // Group conflicts by provider
  const conflictsByProvider = conflicts.reduce((acc, conflict) => {
    const key = conflict.identifier || conflict.email || 'unknown';
    if (!acc[key]) {
      acc[key] = {
        providerName: conflict.providerName,
        displayKey: key,
        conflicts: [],
      };
    }
    acc[key].conflicts.push(conflict);
    return acc;
  }, {} as Record<string, { providerName: string; displayKey: string; conflicts: Conflict[] }>);

  const handleResolutionChange = (identifier: string, field: string, useNew: boolean) => {
    setResolutions((prev) => ({
      ...prev,
      [`${identifier}:${field}`]: useNew,
    }));
  };

  const handleKeepAllCurrent = () => {
    const allCurrent: Record<string, boolean> = {};
    conflicts.forEach((c) => {
      const key = c.identifier || c.email || '';
      allCurrent[`${key}:${c.field}`] = false;
    });
    setResolutions(allCurrent);
  };

  const handleUseAllNew = () => {
    const allNew: Record<string, boolean> = {};
    conflicts.forEach((c) => {
      const key = c.identifier || c.email || '';
      allNew[`${key}:${c.field}`] = true;
    });
    setResolutions(allNew);
  };

  const handleSubmit = () => {
    const result: FieldResolution[] = Object.entries(resolutions).map(([key, useNew]) => {
      const [identifier, field] = key.split(':');
      // Check if identifier is an email (contains @) or a different identifier type
      if (identifier.includes('@')) {
        return { email: identifier, field, useNew };
      }
      return { identifier, field, useNew };
    });
    onResolve(result);
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  };

  const formatIdentifier = (key: string): string => {
    if (key.startsWith('npi:')) return `NPI: ${key.replace('npi:', '')}`;
    if (key.startsWith('email:')) return key.replace('email:', '');
    return key;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Resolve Data Conflicts
          </DialogTitle>
          <DialogDescription>
            The following fields have different values in the database vs the CSV file.
            Choose which value to keep for each conflict.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button variant="outline" size="sm" onClick={handleKeepAllCurrent}>
            <Database className="h-4 w-4 mr-2" />
            Keep All Current
          </Button>
          <Button variant="outline" size="sm" onClick={handleUseAllNew}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Use All New
          </Button>
        </div>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-6">
            {Object.entries(conflictsByProvider).map(([key, { providerName, displayKey, conflicts: providerConflicts }]) => (
              <Card key={key}>
                <CardContent className="pt-4">
                  <div className="font-medium mb-3 flex items-center gap-2">
                    <Badge variant="secondary">{providerName}</Badge>
                    <span className="text-xs text-muted-foreground">{formatIdentifier(displayKey)}</span>
                  </div>
                  
                  <div className="space-y-4">
                    {providerConflicts.map((conflict) => {
                      const identifier = conflict.identifier || conflict.email || '';
                      const resKey = `${identifier}:${conflict.field}`;
                      const useNew = resolutions[resKey] ?? false;
                      
                      return (
                        <div key={resKey} className="border rounded-lg p-3">
                          <div className="font-medium text-sm mb-2">{conflict.fieldLabel}</div>
                          
                          <RadioGroup
                            value={useNew ? 'new' : 'current'}
                            onValueChange={(val) => handleResolutionChange(identifier, conflict.field, val === 'new')}
                            className="space-y-2"
                          >
                            <div className="flex items-start space-x-3">
                              <RadioGroupItem value="current" id={`${resKey}-current`} className="mt-1" />
                              <Label htmlFor={`${resKey}-current`} className="flex-1 cursor-pointer">
                                <div className="flex items-center gap-2">
                                  <Database className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">Current (Database)</span>
                                  {!useNew && <Check className="h-3 w-3 text-primary ml-auto" />}
                                </div>
                                <div className="mt-1 p-2 bg-muted rounded text-sm break-all">
                                  {formatValue(conflict.currentValue)}
                                </div>
                              </Label>
                            </div>
                            
                            <div className="flex items-start space-x-3">
                              <RadioGroupItem value="new" id={`${resKey}-new`} className="mt-1" />
                              <Label htmlFor={`${resKey}-new`} className="flex-1 cursor-pointer">
                                <div className="flex items-center gap-2">
                                  <FileSpreadsheet className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">New (CSV)</span>
                                  {useNew && <Check className="h-3 w-3 text-primary ml-auto" />}
                                </div>
                                <div className="mt-1 p-2 bg-muted rounded text-sm break-all">
                                  {formatValue(conflict.newValue)}
                                </div>
                              </Label>
                            </div>
                          </RadioGroup>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel Import
          </Button>
          <Button onClick={handleSubmit}>
            <Check className="h-4 w-4 mr-2" />
            Apply with Resolutions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
