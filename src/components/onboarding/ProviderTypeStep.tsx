import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Check, Stethoscope, Heart, Brain, UserCheck, Smile } from 'lucide-react';
import { PROVIDER_TYPE_CONFIG, type ProviderType } from '@/types';

interface ProviderTypeStepProps {
  selectedType: ProviderType | null;
  onSelect: (type: ProviderType) => void;
  mode: 'new' | 'edit' | 'admin';
}

const typeIcons: Record<ProviderType, React.ComponentType<{ className?: string }>> = {
  nurse_practitioner: Stethoscope,
  registered_nurse: Heart,
  physician: UserCheck,
  licensed_counselor: Brain,
  mental_health_coach: Smile,
};

export function ProviderTypeStep({ selectedType, onSelect, mode }: ProviderTypeStepProps) {
  const isReadOnly = mode === 'edit';

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold text-foreground">
          {mode === 'new' ? 'What type of provider are you?' : 'Provider Type'}
        </h2>
        <p className="text-muted-foreground mt-2">
          {mode === 'new' 
            ? 'This determines which licensure and compliance requirements apply to you.'
            : 'Your provider type determines workflow requirements.'}
        </p>
      </div>

      {isReadOnly && selectedType && (
        <div className="bg-muted/50 p-4 rounded-lg text-center mb-4">
          <p className="text-sm text-muted-foreground">
            Provider type cannot be changed. Contact Clinical Operations if this needs to be updated.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(PROVIDER_TYPE_CONFIG) as ProviderType[]).map((type) => {
          const config = PROVIDER_TYPE_CONFIG[type];
          const Icon = typeIcons[type];
          const isSelected = selectedType === type;

          return (
            <Card
              key={type}
              className={cn(
                'relative cursor-pointer transition-all hover:border-primary/50',
                isSelected && 'border-primary ring-2 ring-primary/20',
                isReadOnly && !isSelected && 'opacity-50 cursor-not-allowed'
              )}
              onClick={() => !isReadOnly && onSelect(type)}
            >
              {isSelected && (
                <div className="absolute top-3 right-3">
                  <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-4 w-4 text-primary-foreground" />
                  </div>
                </div>
              )}
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'h-10 w-10 rounded-lg flex items-center justify-center',
                    isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  )}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{config.label}</CardTitle>
                    <p className="text-xs text-muted-foreground">{config.shortLabel}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription className="text-sm">
                  {config.description}
                </CardDescription>
                <div className="flex flex-wrap gap-1.5">
                  {config.requiresLicensure ? (
                    <Badge variant="outline" className="text-xs">Licensure Required</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">No Licensure</Badge>
                  )}
                  {config.requiresNPI && (
                    <Badge variant="outline" className="text-xs">NPI Required</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selectedType && (
        <Card className="bg-muted/30 border-dashed mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              What this means for you
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            {PROVIDER_TYPE_CONFIG[selectedType].requiresLicensure ? (
              <>
                <p>✓ You'll select states where you want to practice</p>
                <p>✓ You can report existing licenses for verification</p>
                {PROVIDER_TYPE_CONFIG[selectedType].requiresCollaborativeAgreement && (
                  <p>✓ Collaborative agreements may be required (state-dependent)</p>
                )}
              </>
            ) : (
              <>
                <p>✓ No state licensure requirements</p>
                <p>✓ You'll complete internal compliance training only</p>
                <p>✓ Faster onboarding process</p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
