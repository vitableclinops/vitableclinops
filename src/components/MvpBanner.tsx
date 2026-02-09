import { AlertTriangle, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useMvpMode } from '@/hooks/useSystemConfig';

export function MvpBanner() {
  const { enabled, message } = useMvpMode();

  if (!enabled) return null;

  return (
    <Alert className="border-warning/50 bg-warning/5 mb-4">
      <Info className="h-4 w-4 text-warning" />
      <AlertTitle className="text-warning">MVP Parallel-System Mode</AlertTitle>
      <AlertDescription className="text-muted-foreground text-sm">
        {message}
      </AlertDescription>
    </Alert>
  );
}
