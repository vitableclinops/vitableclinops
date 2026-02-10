import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, UserPlus, Copy, Eye, EyeOff } from 'lucide-react';
import { PROVIDER_TYPE_CONFIG, type ProviderType } from '@/types';
import { StateSelectionStep } from '@/components/onboarding/StateSelectionStep';
import { getCollabRequirementType } from '@/constants/stateRestrictions';

interface ProviderFormData {
  fullName: string;
  email: string;
  npiNumber: string;
  providerType: ProviderType | '';
  employmentType: 'w2' | '1099' | 'agency' | '';
  agencyId: string;
  primarySpecialty: string;
  minPatientAge: string;
  bio: string;
  phoneNumber: string;
  selectedStates: string[];
  createAccount: boolean;
}

export default function AdminAddProviderPage() {
  const navigate = useNavigate();
  const { profile, roles } = useAuth();
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin';
  const userEmail = profile?.email || '';

  const [formData, setFormData] = useState<ProviderFormData>({
    fullName: '',
    email: '',
    npiNumber: '',
    providerType: '',
    employmentType: '',
    agencyId: '',
    primarySpecialty: '',
    minPatientAge: '',
    bio: '',
    phoneNumber: '',
    selectedStates: [],
    createAccount: false,
  });

  const [step, setStep] = useState<'details' | 'states' | 'review'>('details');
  const [createdResult, setCreatedResult] = useState<{ profileId: string; tempPassword?: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const update = (updates: Partial<ProviderFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const requiresLicensure = formData.providerType
    ? PROVIDER_TYPE_CONFIG[formData.providerType as ProviderType]?.requiresLicensure
    : false;

  const requiresNPI = formData.providerType
    ? PROVIDER_TYPE_CONFIG[formData.providerType as ProviderType]?.requiresNPI
    : false;

  const createProviderMutation = useMutation({
    mutationFn: async () => {
      const nameParts = formData.fullName.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      let userId: string | null = null;
      let tempPassword: string | undefined;

      // Optionally create an auth account
      if (formData.createAccount) {
        const { data: result, error } = await supabase.functions.invoke('admin-create-user', {
          body: {
            email: formData.email,
            password: undefined, // let the function generate one
            fullName: formData.fullName,
            roles: ['provider'],
          },
        });

        if (error) throw new Error(error.message);
        if (result?.error) throw new Error(result.error);

        userId = result.userId;
        tempPassword = result.password;
      }

      // Determine activation status
      let activationStatus = 'pending_onboarding';
      if (formData.selectedStates.length > 0) {
        const hasCollabStates = formData.selectedStates.some(
          s => getCollabRequirementType(s) === 'always'
        );
        activationStatus = hasCollabStates ? 'pending_agreements' : 'pending_review';
      }

      // Create the profile row
      const { data: newProfile, error: profileError } = await supabase
        .from('profiles')
        .insert({
          email: formData.email,
          full_name: formData.fullName,
          first_name: firstName,
          last_name: lastName,
          npi_number: formData.npiNumber || null,
          profession: formData.providerType || null,
          primary_specialty: formData.primarySpecialty || null,
          min_patient_age: formData.minPatientAge || null,
          bio: formData.bio || null,
          phone_number: formData.phoneNumber || null,
          employment_type: formData.employmentType || null,
          agency_id: formData.employmentType === 'agency' ? formData.agencyId || null : null,
          employment_status: 'active',
          actively_licensed_states: formData.selectedStates.join(',') || null,
          activation_status: activationStatus,
          user_id: userId,
          onboarding_completed: false,
        })
        .select('id')
        .single();

      if (profileError) throw profileError;

      // Create provider_licenses for selected states
      if (formData.selectedStates.length > 0) {
        const licenseRows = formData.selectedStates.map(stateAbbr => ({
          profile_id: newProfile.id,
          provider_email: formData.email,
          state_abbreviation: stateAbbr,
          license_type: 'APRN',
          status: 'pending_verification',
          requires_collab_agreement: getCollabRequirementType(stateAbbr) === 'always',
        }));

        await supabase.from('provider_licenses').insert(licenseRows);
      }

      // Create admin task for follow-up
      await supabase.from('agreement_tasks').insert({
        provider_id: newProfile.id,
        title: `Complete intake for ${formData.fullName}`,
        description: `A new provider profile was created by admin. Review and complete any remaining onboarding steps.`,
        category: 'compliance',
        status: 'pending',
        priority: 'medium',
        assigned_role: 'admin',
        is_auto_generated: true,
        auto_trigger: 'admin_add_provider',
      });

      return { profileId: newProfile.id, tempPassword };
    },
    onSuccess: (data) => {
      setCreatedResult(data);
      toast({
        title: 'Provider Added',
        description: `${formData.fullName} has been added to the system.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleCopyPassword = () => {
    if (createdResult?.tempPassword) {
      navigator.clipboard.writeText(createdResult.tempPassword);
      toast({ title: 'Copied', description: 'Temporary password copied to clipboard.' });
    }
  };

  const canProceedFromDetails = () => {
    return formData.fullName.trim() !== '' && formData.email.trim() !== '' && formData.providerType !== '';
  };

  const handleSubmit = () => {
    createProviderMutation.mutate();
  };

  // Success state
  if (createdResult) {
    return (
      <div className="min-h-screen bg-background">
        <AppSidebar userRole={userRole as any} userName={userName} userEmail={userEmail} userAvatarUrl={profile?.avatar_url || undefined} />
        <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
          <div className="p-4 md:p-6 lg:p-8 max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle className="text-success flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  Provider Added Successfully
                </CardTitle>
                <CardDescription>
                  {formData.fullName} has been added to the provider directory.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <div className="text-sm font-medium">{formData.email}</div>
                </div>

                {createdResult.tempPassword && (
                  <div className="space-y-2">
                    <Label>Temporary Password</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={createdResult.tempPassword}
                        readOnly
                        className="font-mono"
                      />
                      <Button variant="outline" size="icon" onClick={() => setShowPassword(!showPassword)}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button variant="outline" size="icon" onClick={handleCopyPassword}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Share this with the provider. They will be prompted to change it on first login.
                    </p>
                  </div>
                )}

                {formData.selectedStates.length > 0 && (
                  <div className="space-y-2">
                    <Label>Licensed States</Label>
                    <div className="text-sm">{formData.selectedStates.join(', ')}</div>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={() => navigate('/providers')}>
                    Back to Directory
                  </Button>
                  <Button onClick={() => {
                    setCreatedResult(null);
                    setFormData({
                      fullName: '', email: '', npiNumber: '', providerType: '',
                      employmentType: '', agencyId: '', primarySpecialty: '',
                      minPatientAge: '', bio: '', phoneNumber: '',
                      selectedStates: [], createAccount: false,
                    });
                    setStep('details');
                  }}>
                    Add Another Provider
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar userRole={userRole as any} userName={userName} userEmail={userEmail} userAvatarUrl={profile?.avatar_url || undefined} />
      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8 max-w-3xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Button variant="ghost" size="icon" onClick={() => navigate('/providers')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Add Provider</h1>
              <p className="text-muted-foreground">Create a new provider profile in the system</p>
            </div>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-4 mb-8">
            {['Provider Details', ...(requiresLicensure ? ['States'] : []), 'Review & Submit'].map((label, idx) => {
              const stepKeys = ['details', ...(requiresLicensure ? ['states'] : []), 'review'];
              const currentIdx = stepKeys.indexOf(step);
              const isActive = idx === currentIdx;
              const isCompleted = idx < currentIdx;
              return (
                <div key={label} className="flex items-center gap-2 flex-1">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium border-2 ${
                    isCompleted ? 'bg-primary border-primary text-primary-foreground' :
                    isActive ? 'border-primary text-primary' :
                    'border-muted text-muted-foreground'
                  }`}>
                    {idx + 1}
                  </div>
                  <span className={`text-sm ${isActive ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                    {label}
                  </span>
                  {idx < stepKeys.length - 1 && <div className={`flex-1 h-0.5 ${isCompleted ? 'bg-primary' : 'bg-muted'}`} />}
                </div>
              );
            })}
          </div>

          {/* Step: Details */}
          {step === 'details' && (
            <Card>
              <CardHeader>
                <CardTitle>Provider Information</CardTitle>
                <CardDescription>Enter the provider's details. This creates their profile in the system.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name *</Label>
                    <Input
                      id="fullName"
                      placeholder="Jane Smith"
                      value={formData.fullName}
                      onChange={e => update({ fullName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address *</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="jane.smith@company.com"
                      value={formData.email}
                      onChange={e => update({ email: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="providerType">Provider Type *</Label>
                    <Select value={formData.providerType} onValueChange={v => update({ providerType: v as ProviderType })}>
                      <SelectTrigger id="providerType">
                        <SelectValue placeholder="Select provider type" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROVIDER_TYPE_CONFIG).map(([key, config]) => (
                          <SelectItem key={key} value={key}>{config.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employmentType">Employment Type</Label>
                    <Select value={formData.employmentType} onValueChange={v => update({ employmentType: v as any })}>
                      <SelectTrigger id="employmentType">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="w2">W-2 Employee</SelectItem>
                        <SelectItem value="1099">1099 Contractor</SelectItem>
                        <SelectItem value="agency">Agency</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {requiresNPI && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="npiNumber">NPI Number</Label>
                      <Input
                        id="npiNumber"
                        placeholder="1234567890"
                        value={formData.npiNumber}
                        onChange={e => update({ npiNumber: e.target.value })}
                        maxLength={10}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="primarySpecialty">Primary Specialty</Label>
                      <Input
                        id="primarySpecialty"
                        placeholder="e.g. Psychiatry"
                        value={formData.primarySpecialty}
                        onChange={e => update({ primarySpecialty: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                      id="phone"
                      placeholder="(555) 123-4567"
                      value={formData.phoneNumber}
                      onChange={e => update({ phoneNumber: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="minAge">Minimum Patient Age</Label>
                    <Select value={formData.minPatientAge} onValueChange={v => update({ minPatientAge: v })}>
                      <SelectTrigger id="minAge">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1.5">1.5+ years</SelectItem>
                        <SelectItem value="13">13+ years</SelectItem>
                        <SelectItem value="17">17+ years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bio">Bio</Label>
                  <Textarea
                    id="bio"
                    placeholder="Professional background and specialties..."
                    value={formData.bio}
                    onChange={e => update({ bio: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="createAccount" className="font-medium">Create Login Account</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Create an authentication account so this provider can log in. A temporary password will be generated.
                      </p>
                    </div>
                    <Switch
                      id="createAccount"
                      checked={formData.createAccount}
                      onCheckedChange={v => update({ createAccount: v })}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="outline" onClick={() => navigate('/providers')}>Cancel</Button>
                  {requiresLicensure ? (
                    <Button onClick={() => setStep('states')} disabled={!canProceedFromDetails()}>
                      Next: Select States
                    </Button>
                  ) : (
                    <Button onClick={() => setStep('review')} disabled={!canProceedFromDetails()}>
                      Next: Review
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step: States */}
          {step === 'states' && (
            <Card>
              <CardHeader>
                <CardTitle>Licensed States</CardTitle>
                <CardDescription>Select the states where {formData.fullName || 'this provider'} is or will be licensed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <StateSelectionStep
                  selectedStates={formData.selectedStates}
                  onUpdate={states => update({ selectedStates: states })}
                  providerType={formData.providerType as ProviderType || null}
                  showPendingOption={false}
                />

                <div className="flex justify-between pt-4">
                  <Button variant="outline" onClick={() => setStep('details')}>Back</Button>
                  <Button onClick={() => setStep('review')}>
                    Next: Review
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step: Review */}
          {step === 'review' && (
            <Card>
              <CardHeader>
                <CardTitle>Review & Submit</CardTitle>
                <CardDescription>Confirm the provider details before creating the profile.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label className="text-muted-foreground text-xs">Full Name</Label>
                    <p className="font-medium">{formData.fullName}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Email</Label>
                    <p className="font-medium">{formData.email}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Provider Type</Label>
                    <p className="font-medium">
                      {formData.providerType ? PROVIDER_TYPE_CONFIG[formData.providerType as ProviderType]?.label : '—'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Employment Type</Label>
                    <p className="font-medium">{formData.employmentType || '—'}</p>
                  </div>
                  {formData.npiNumber && (
                    <div>
                      <Label className="text-muted-foreground text-xs">NPI</Label>
                      <p className="font-medium">{formData.npiNumber}</p>
                    </div>
                  )}
                  {formData.selectedStates.length > 0 && (
                    <div className="md:col-span-2">
                      <Label className="text-muted-foreground text-xs">States</Label>
                      <p className="font-medium">{formData.selectedStates.join(', ')}</p>
                    </div>
                  )}
                  <div>
                    <Label className="text-muted-foreground text-xs">Login Account</Label>
                    <p className="font-medium">{formData.createAccount ? 'Will be created' : 'Not creating (profile only)'}</p>
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t">
                  <Button variant="outline" onClick={() => setStep(requiresLicensure ? 'states' : 'details')}>
                    Back
                  </Button>
                  <Button onClick={handleSubmit} disabled={createProviderMutation.isPending}>
                    {createProviderMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create Provider
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
