import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, Info, Clock, Users } from 'lucide-react';

interface CollaborationConsentStepProps {
  statesRequiringCollab: string[];
  conditionalStates?: string[];
  onConsent: (consented: boolean) => void;
  consented: boolean;
}

export function CollaborationConsentStep({
  statesRequiringCollab,
  conditionalStates = [],
  onConsent,
  consented,
}: CollaborationConsentStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <Users className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          Collaborative Agreement Requirements
        </h2>
        <p className="text-muted-foreground mt-2">
          Some of your selected states have collaboration requirements.
        </p>
      </div>

      {/* States that ALWAYS require collaboration */}
      {statesRequiringCollab.length > 0 && (
        <Card className="border-warning/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-5 w-5 text-warning" />
              Collaboration Required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The following states require a collaborative agreement with a physician before you can practice:
            </p>
            <div className="flex flex-wrap gap-2">
              {statesRequiringCollab.map((state) => (
                <Badge key={state} variant="secondary" className="bg-warning/10 text-warning border-warning/30">
                  {state}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* States that are CONDITIONAL */}
      {conditionalStates.length > 0 && (
        <Card className="border-blue-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-5 w-5 text-blue-600" />
              Under Review by Clinical Ops
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The following states have conditional requirements that depend on your Full Practice Authority (FPA) eligibility. Clinical Operations will review your credentials and confirm whether collaboration is needed:
            </p>
            <div className="flex flex-wrap gap-2">
              {conditionalStates.map((state) => (
                <Badge key={state} variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">
                  {state}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground italic">
              No action required from you. An admin will contact you if collaboration is needed.
            </p>
          </CardContent>
        </Card>
      )}

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Collaborative agreements allow you to provide clinical services in regulated states. Clinical Operations will help set these up after you complete onboarding.
        </AlertDescription>
      </Alert>

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

      {statesRequiringCollab.length > 0 && (
        <div className="flex items-start gap-4 p-4 border rounded-lg">
          <Checkbox
            id="collab-consent"
            checked={consented}
            onCheckedChange={(checked) => onConsent(checked === true)}
            className="mt-0.5"
          />
          <label htmlFor="collab-consent" className="text-sm cursor-pointer">
            I understand that Clinical Operations will initiate collaborative agreements for the states that require them, and I approve this process.
          </label>
        </div>
      )}

      {statesRequiringCollab.length === 0 && conditionalStates.length > 0 && (
        <div className="flex items-start gap-4 p-4 border rounded-lg bg-muted/50">
          <Checkbox
            id="collab-consent"
            checked={consented}
            onCheckedChange={(checked) => onConsent(checked === true)}
            className="mt-0.5"
          />
          <label htmlFor="collab-consent" className="text-sm cursor-pointer">
            I acknowledge that some states are under review and Clinical Operations may contact me regarding collaboration requirements.
          </label>
        </div>
      )}
    </div>
  );
}
