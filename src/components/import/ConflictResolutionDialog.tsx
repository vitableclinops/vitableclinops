import { useState } from 'react';
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
import { AlertTriangle, ArrowRight, Check, Database, FileSpreadsheet } from 'lucide-react';

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
  const [resolutions, setResolutions] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    conflicts.forEach((c) => {
      initial[`${c.email}:${c.field}`] = false; // Default: keep current
    });
    return initial;
  });

  // Group conflicts by provider
  const conflictsByProvider = conflicts.reduce((acc, conflict) => {
    if (!acc[conflict.email]) {
      acc[conflict.email] = {
        providerName: conflict.providerName,
        conflicts: [],
      };
    }
    acc[conflict.email].conflicts.push(conflict);
    return acc;
  }, {} as Record<string, { providerName: string; conflicts: Conflict[] }>);

  const handleResolutionChange = (email: string, field: string, useNew: boolean) => {
    setResolutions((prev) => ({
      ...prev,
      [`${email}:${field}`]: useNew,
    }));
  };

  const handleKeepAllCurrent = () => {
    const allCurrent: Record<string, boolean> = {};
    conflicts.forEach((c) => {
      allCurrent[`${c.email}:${c.field}`] = false;
    });
    setResolutions(allCurrent);
  };

  const handleUseAllNew = () => {
    const allNew: Record<string, boolean> = {};
    conflicts.forEach((c) => {
      allNew[`${c.email}:${c.field}`] = true;
    });
    setResolutions(allNew);
  };

  const handleSubmit = () => {
    const result: FieldResolution[] = Object.entries(resolutions).map(([key, useNew]) => {
      const [email, field] = key.split(':');
      return { email, field, useNew };
    });
    onResolve(result);
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
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
            {Object.entries(conflictsByProvider).map(([email, { providerName, conflicts: providerConflicts }]) => (
              <Card key={email}>
                <CardContent className="pt-4">
                  <div className="font-medium mb-3 flex items-center gap-2">
                    <Badge variant="secondary">{providerName}</Badge>
                    <span className="text-xs text-muted-foreground">{email}</span>
                  </div>
                  
                  <div className="space-y-4">
                    {providerConflicts.map((conflict) => {
                      const key = `${conflict.email}:${conflict.field}`;
                      const useNew = resolutions[key] ?? false;
                      
                      return (
                        <div key={key} className="border rounded-lg p-3">
                          <div className="font-medium text-sm mb-2">{conflict.fieldLabel}</div>
                          
                          <RadioGroup
                            value={useNew ? 'new' : 'current'}
                            onValueChange={(val) => handleResolutionChange(conflict.email, conflict.field, val === 'new')}
                            className="space-y-2"
                          >
                            <div className="flex items-start space-x-3">
                              <RadioGroupItem value="current" id={`${key}-current`} className="mt-1" />
                              <Label htmlFor={`${key}-current`} className="flex-1 cursor-pointer">
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
                              <RadioGroupItem value="new" id={`${key}-new`} className="mt-1" />
                              <Label htmlFor={`${key}-new`} className="flex-1 cursor-pointer">
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
