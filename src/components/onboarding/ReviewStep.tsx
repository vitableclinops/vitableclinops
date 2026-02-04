import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ClipboardCheck, User, MapPin, FileCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { allUSStatesSorted } from '@/data/allStates';
import { PROVIDER_TYPE_CONFIG } from '@/types';
import type { OnboardingData } from './OnboardingWizard';

interface ReviewStepProps {
  data: OnboardingData;
  mode: 'new' | 'edit' | 'admin';
}

export function ReviewStep({ data, mode }: ReviewStepProps) {
  const getLicensesByState = () => {
    const grouped: Record<string, typeof data.reportedLicenses> = {};
    data.selectedStates.forEach(stateAbbr => {
      grouped[stateAbbr] = data.reportedLicenses.filter(l => l.state === stateAbbr);
    });
    return grouped;
  };

  const licensesByState = getLicensesByState();
  const totalLicenses = data.reportedLicenses.length;
  const providerTypeConfig = data.providerType ? PROVIDER_TYPE_CONFIG[data.providerType] : null;
  const requiresLicensure = providerTypeConfig?.requiresLicensure ?? true;

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="mx-auto w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-4">
          <ClipboardCheck className="h-8 w-8 text-success" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Review & Submit</h2>
        <p className="text-muted-foreground mt-2">
          Please review your information before submitting.
        </p>
      </div>

      {/* Summary Stats - only show if licensure required */}
      {requiresLicensure && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="text-center">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary">{data.selectedStates.length}</div>
              <p className="text-xs text-muted-foreground">States Selected</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary">{totalLicenses}</div>
              <p className="text-xs text-muted-foreground">Licenses Reported</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary">
                {data.reportedLicenses.filter(l => l.evidenceUploaded).length}
              </div>
              <p className="text-xs text-muted-foreground">With Evidence</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Provider Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            Provider Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Provider Type</p>
              <p className="font-medium">{providerTypeConfig?.label || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Name</p>
              <p className="font-medium">{data.providerName || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">{data.providerEmail || '—'}</p>
            </div>
            {providerTypeConfig?.requiresNPI && (
              <div>
                <p className="text-muted-foreground">NPI Number</p>
                <p className="font-medium">{data.npiNumber || '—'}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* States & Licenses - only show if licensure required */}
      {requiresLicensure && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              States & Licenses
            </CardTitle>
            <CardDescription>
              {data.selectedStates.length} state{data.selectedStates.length !== 1 ? 's' : ''} selected
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.selectedStates.map((stateAbbr, index) => {
              const state = allUSStatesSorted.find(s => s.abbreviation === stateAbbr);
              const licenses = licensesByState[stateAbbr] || [];

              return (
                <div key={stateAbbr}>
                  {index > 0 && <Separator className="my-4" />}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{state?.name || stateAbbr}</span>
                        <Badge variant="outline" className="text-xs">
                          {stateAbbr}
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        {state?.hasFPA && (
                          <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                            FPA
                          </Badge>
                        )}
                        {state?.requiresCollaborativeAgreement && (
                          <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                            CA Required
                          </Badge>
                        )}
                      </div>
                    </div>

                    {licenses.length > 0 ? (
                      <div className="pl-4 space-y-2">
                        {licenses.map(license => (
                          <div
                            key={license.id}
                            className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <FileCheck className="h-4 w-4 text-muted-foreground" />
                              <span>{license.licenseType}</span>
                              {license.licenseNumber && (
                                <span className="text-muted-foreground">#{license.licenseNumber}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {license.expirationDate && (
                                <span className="text-xs text-muted-foreground">
                                  Exp: {license.expirationDate}
                                </span>
                              )}
                              {license.evidenceUploaded ? (
                                <CheckCircle2 className="h-4 w-4 text-success" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-warning" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground pl-4">
                        No licenses reported for this state
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Next steps for coaches */}
      {!requiresLicensure && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Next Steps</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>After completing onboarding, you'll be assigned internal compliance training and policy acknowledgments. No state licensure is required for your role.</p>
          </CardContent>
        </Card>
      )}

      {/* What happens next */}
      <Card className="bg-muted/50 border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">What happens next?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          {mode === 'new' ? (
            requiresLicensure ? (
              <>
                <p>1. <strong>Clinical Operations will review</strong> your reported licenses</p>
                <p>2. <strong>Tasks will be assigned</strong> for any missing licenses in your selected states</p>
                <p>3. <strong>You'll be notified</strong> when you're ready to practice in each state</p>
              </>
            ) : (
              <>
                <p>1. <strong>Your profile will be created</strong> in the system</p>
                <p>2. <strong>Compliance training</strong> will be assigned</p>
                <p>3. <strong>You'll receive notifications</strong> when tasks are ready</p>
              </>
            )
          ) : mode === 'edit' ? (
            <>
              <p>1. <strong>Your changes will be saved</strong> and reviewed by Clinical Operations</p>
              <p>2. <strong>Any new licenses</strong> you reported will be verified</p>
              <p>3. <strong>Your activation status</strong> will be updated accordingly</p>
            </>
          ) : (
            <>
              <p>1. <strong>Provider information will be updated</strong> in the system</p>
              <p>2. <strong>New licenses</strong> will be added to the verification queue</p>
              <p>3. <strong>Activation readiness</strong> will be recalculated</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
