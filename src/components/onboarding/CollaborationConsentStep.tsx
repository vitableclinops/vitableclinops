import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Info } from 'lucide-react';

interface CollaborationConsentStepProps {
  statesRequiringCollab: string[];
  onConsent: (consented: boolean) => void;
  consented: boolean;
}

export function CollaborationConsentStep({
  statesRequiringCollab,
  onConsent,
  consented,
}: CollaborationConsentStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <Info className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          Collaborative Agreement Requirements
        </h2>
        <p className="text-muted-foreground mt-2">
          Some of your selected states require a collaborative agreement.
        </p>
      </div>

      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          Collaborative agreements allow you to provide clinical services in regulated states. Clinical Operations will help set these up after you complete onboarding.
        </AlertDescription>
      </Alert>

      <div className="space-y-3">
        <h3 className="font-medium">States Requiring Collaboration:</h3>
        <div className="flex flex-wrap gap-2">
          {statesRequiringCollab.map((state) => (
            <Badge key={state} variant="secondary">
              {state}
            </Badge>
          ))}
        </div>
      </div>

      <Card className="bg-muted/50 border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Next Steps</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. <strong>Submit your information</strong> — Complete this onboarding wizard</p>
          <p>2. <strong>Clinical Operations contacts you</strong> — They'll identify suitable collaborating physicians</p>
          <p>3. <strong>Agreement preparation</strong> — Documents are prepared and sent for signature</p>
          <p>4. <strong>Execution and activation</strong> — Once signed, you're ready to practice in that state</p>
        </CardContent>
      </Card>

      <div className="flex items-start gap-4">
        <input
          type="checkbox"
          id="collab-consent"
          checked={consented}
          onChange={(e) => onConsent(e.target.checked)}
          className="mt-1"
        />
        <label htmlFor="collab-consent" className="text-sm">
          I understand that Clinical Operations will initiate collaborative agreements for the states that require them, and I approve this process.
        </label>
      </div>
    </div>
  );
}
