import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { User, Mail, Hash, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PROVIDER_TYPE_CONFIG } from '@/types';
import type { OnboardingData } from './OnboardingWizard';

interface WelcomeStepProps {
  mode: 'new' | 'edit' | 'admin';
  data: OnboardingData;
  onUpdate: (updates: Partial<OnboardingData>) => void;
}

export function WelcomeStep({ mode, data, onUpdate }: WelcomeStepProps) {
  const isReadOnly = mode === 'edit';
  const requiresNPI = data.providerType && PROVIDER_TYPE_CONFIG[data.providerType].requiresNPI;

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <User className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          {mode === 'new' ? 'Your Information' : 'Confirm Your Information'}
        </h2>
        <p className="text-muted-foreground mt-2">
          {mode === 'new' 
            ? 'Tell us a bit about yourself.'
            : 'Please verify your information is correct before continuing.'}
        </p>
      </div>

      {mode === 'edit' && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            To change your name, email, or NPI number, please contact Clinical Operations.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="providerName" className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            Full Name
          </Label>
          <Input
            id="providerName"
            placeholder="Jane Smith"
            value={data.providerName}
            onChange={(e) => onUpdate({ providerName: e.target.value })}
            disabled={isReadOnly}
            className={isReadOnly ? 'bg-muted' : ''}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="providerEmail" className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            Email Address
          </Label>
          <Input
            id="providerEmail"
            type="email"
            placeholder="jane.smith@company.com"
            value={data.providerEmail}
            onChange={(e) => onUpdate({ providerEmail: e.target.value })}
            disabled={isReadOnly}
            className={isReadOnly ? 'bg-muted' : ''}
          />
        </div>

        {requiresNPI && (
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="npiNumber" className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              NPI Number
            </Label>
            <Input
              id="npiNumber"
              placeholder="1234567890"
              value={data.npiNumber}
              onChange={(e) => onUpdate({ npiNumber: e.target.value })}
              disabled={isReadOnly}
              className={isReadOnly ? 'bg-muted' : 'max-w-xs'}
              maxLength={10}
            />
            <p className="text-xs text-muted-foreground">
              Your 10-digit National Provider Identifier
            </p>
          </div>
        )}
      </div>

      {mode === 'new' && data.providerType && (
        <Card className="bg-muted/50 border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">What happens next?</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            {PROVIDER_TYPE_CONFIG[data.providerType].requiresLicensure ? (
              <>
                <p>1. <strong>Select your states</strong> — Choose the states where you want to practice</p>
                <p>2. <strong>Report existing licenses</strong> — Tell us about licenses you already hold</p>
                <p>3. <strong>Review and submit</strong> — Clinical Operations will verify your information</p>
              </>
            ) : (
              <>
                <p>1. <strong>Review your info</strong> — Confirm everything looks correct</p>
                <p>2. <strong>Complete onboarding</strong> — You'll be assigned compliance training</p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
