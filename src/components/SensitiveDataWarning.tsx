import { useState, useCallback } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSensitiveDataGuard } from '@/hooks/useSensitiveDataGuard';

interface SensitiveDataWarningProps {
  value: string;
  fieldName: string;
  entityType?: string;
  entityId?: string;
}

export function SensitiveDataWarning({ value, fieldName, entityType = 'profile', entityId }: SensitiveDataWarningProps) {
  const { checkForSensitiveData, logSensitiveAccess } = useSensitiveDataGuard();
  const [hasLogged, setHasLogged] = useState(false);

  const result = checkForSensitiveData(value);

  if (result.isSensitive && !hasLogged) {
    logSensitiveAccess(fieldName, entityType, entityId, result.matchedPattern || undefined);
    setHasLogged(true);
  }

  if (!result.isSensitive) return null;

  return (
    <Alert variant="destructive" className="mt-2">
      <ShieldAlert className="h-4 w-4" />
      <AlertDescription className="text-sm">
        <strong>Prohibited Data Detected:</strong> {result.matchedPattern}. 
        This platform does not store SSNs, banking details, or tax documents. 
        Please remove this information.
      </AlertDescription>
    </Alert>
  );
}

// Inline warning for form fields
export function useSensitiveFieldCheck() {
  const { checkForSensitiveData } = useSensitiveDataGuard();

  return useCallback((value: string) => {
    return checkForSensitiveData(value);
  }, [checkForSensitiveData]);
}
