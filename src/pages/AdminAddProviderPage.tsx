import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, UserPlus, Copy, Eye, EyeOff } from 'lucide-react';
import { PROVIDER_TYPE_CONFIG, type ProviderType } from '@/types';
import { StateSelectionStep } from '@/components/onboarding/StateSelectionStep';
import { getCollabRequirementType } from '@/constants/stateRestrictions';

// ── Schema ────────────────────────────────────────────────────────────────────

const PROVIDER_TYPES = Object.keys(PROVIDER_TYPE_CONFIG) as [ProviderType, ...ProviderType[]];

const providerSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required'),
    email: z.string().trim().email('Enter a valid email address'),
    npiNumber: z.string().trim().optional().default(''),
    providerType: z.enum(PROVIDER_TYPES, {
      errorMap: () => ({ message: 'Select a provider type' }),
    }),
    employmentType: z.enum(['w2', '1099', 'agency', '']).default(''),
    agencyId: z.string().default(''),
    primarySpecialty: z.string().default(''),
    minPatientAge: z.string().default(''),
    bio: z.string().default(''),
    phoneNumber: z.string().default(''),
    selectedStates: z.array(z.string()).default([]),
    createAccount: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    const config = PROVIDER_TYPE_CONFIG[val.providerType];
    if (config?.requiresNPI && val.npiNumber && !/^\d{10}$/.test(val.npiNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['npiNumber'],
        message: 'NPI must be exactly 10 digits',
      });
    }
    if (val.phoneNumber && val.phoneNumber.replace(/\D/g, '').length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phoneNumber'],
        message: 'Phone must have at least 10 digits',
      });
    }
  });

type ProviderFormValues = z.infer<typeof providerSchema>;

const defaultValues: ProviderFormValues = {
  fullName: '',
  email: '',
  npiNumber: '',
  providerType: '' as ProviderType,
  employmentType: '',
  agencyId: '',
  primarySpecialty: '',
  minPatientAge: '',
  bio: '',
  phoneNumber: '',
  selectedStates: [],
  createAccount: false,
};

export default function AdminAddProviderPage() {
  const navigate = useNavigate();
  const { profile, roles } = useAuth();
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin';
  const userEmail = profile?.email || '';

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerSchema),
    defaultValues,
    mode: 'onBlur',
  });

  const values = form.watch();

  const [step, setStep] = useState<'details' | 'states' | 'review'>('details');
  const [createdResult, setCreatedResult] = useState<{ profileId: string; tempPassword?: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const requiresLicensure = values.providerType
    ? PROVIDER_TYPE_CONFIG[values.providerType as ProviderType]?.requiresLicensure
    : false;

  const requiresNPI = values.providerType
    ? PROVIDER_TYPE_CONFIG[values.providerType as ProviderType]?.requiresNPI
    : false;

  const createProviderMutation = useMutation({
    mutationFn: async (data: ProviderFormValues) => {
      const nameParts = data.fullName.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      let userId: string | null = null;
      let tempPassword: string | undefined;

      if (data.createAccount) {
        const { data: result, error } = await supabase.functions.invoke('admin-create-user', {
          body: {
            email: data.email,
            password: undefined,
            fullName: data.fullName,
            roles: ['provider'],
          },
        });

        if (error) throw new Error(error.message);
        if (result?.error) throw new Error(result.error);

        userId = result.userId;
        tempPassword = result.password;
      }

      let activationStatus = 'pending_onboarding';
      if (data.selectedStates.length > 0) {
        const hasCollabStates = data.selectedStates.some(
          s => getCollabRequirementType(s) === 'always'
        );
        activationStatus = hasCollabStates ? 'pending_agreements' : 'pending_review';
      }

      const { data: newProfile, error: profileError } = await supabase
        .from('profiles')
        .insert({
          email: data.email,
          full_name: data.fullName,
          first_name: firstName,
          last_name: lastName,
          npi_number: data.npiNumber || null,
          profession: data.providerType || null,
          primary_specialty: data.primarySpecialty || null,
          min_patient_age: data.minPatientAge || null,
          bio: data.bio || null,
          phone_number: data.phoneNumber || null,
          employment_type: data.employmentType || null,
          agency_id: data.employmentType === 'agency' ? data.agencyId || null : null,
          employment_status: 'active',
          activation_status: activationStatus,
          user_id: userId,
          onboarding_completed: false,
        })
        .select('id')
        .single();

      if (profileError) throw profileError;

      if (data.selectedStates.length > 0) {
        const licenseRows = data.selectedStates.map(stateAbbr => ({
          profile_id: newProfile.id,
          provider_email: data.email,
          state_abbreviation: stateAbbr,
          license_type: 'APRN',
          status: 'pending_verification',
          requires_collab_agreement: getCollabRequirementType(stateAbbr) === 'always',
        }));

        await supabase.from('provider_licenses').insert(licenseRows);
      }

      await supabase.from('agreement_tasks').insert({
        provider_id: newProfile.id,
        title: `Complete intake for ${data.fullName}`,
        description: `A new provider profile was created by admin. Review and complete any remaining onboarding steps.`,
        category: 'compliance',
        status: 'pending',
        priority: 'medium',
        assigned_role: 'admin',
        is_auto_generated: true,
        auto_trigger: 'admin_add_provider',
      });

      // Mirror to the ClinOps scheduling project's `providers` table so the
      // Jotform matcher and unmatched-link search find this provider
      // immediately (instead of waiting for the next roster sync). Best-effort:
      // a failure here doesn't roll back the directory entry.
      try {
        const { error: syncErr } = await clinopsSupabase.functions.invoke(
          'sync-directory-provider',
          {
            body: {
              email: data.email,
              name: data.fullName,
              profession: data.providerType || null,
              npi: data.npiNumber || null,
              employment_type: data.employmentType || null,
              employment_status: 'active',
              source: 'directory',
            },
          },
        );
        if (syncErr) {
          console.warn('sync-directory-provider failed:', syncErr.message);
        }
      } catch (err) {
        console.warn('sync-directory-provider threw:', err);
      }

      return { profileId: newProfile.id, tempPassword };
    },
    onSuccess: (data) => {
      setCreatedResult(data);
      toast({
        title: 'Provider Added',
        description: `${values.fullName} has been added to the system.`,
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

  const handleNextFromDetails = async () => {
    const valid = await form.trigger([
      'fullName',
      'email',
      'providerType',
      'npiNumber',
      'phoneNumber',
    ]);
    if (!valid) return;
    setStep(requiresLicensure ? 'states' : 'review');
  };

  const onSubmit = form.handleSubmit((data) => {
    createProviderMutation.mutate(data);
  });

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
                  {values.fullName} has been added to the provider directory.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <div className="text-sm font-medium">{values.email}</div>
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
                      <Button variant="outline" size="icon" aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button variant="outline" size="icon" aria-label="Copy password to clipboard" title="Copy password" onClick={handleCopyPassword}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Share this with the provider. They will be prompted to change it on first login.
                    </p>
                  </div>
                )}

                {values.selectedStates.length > 0 && (
                  <div className="space-y-2">
                    <Label>Licensed States</Label>
                    <div className="text-sm">{values.selectedStates.join(', ')}</div>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={() => navigate('/providers')}>
                    Back to Directory
                  </Button>
                  <Button onClick={() => {
                    setCreatedResult(null);
                    form.reset(defaultValues);
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
            <Button variant="ghost" size="icon" aria-label="Back to providers" title="Back to providers" onClick={() => navigate('/providers')}>
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

          <Form {...form}>
            <form onSubmit={onSubmit}>
              {/* Step: Details */}
              {step === 'details' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Provider Information</CardTitle>
                    <CardDescription>Enter the provider's details. This creates their profile in the system.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="fullName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Full Name *</FormLabel>
                            <FormControl>
                              <Input placeholder="Jane Smith" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email Address *</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="jane.smith@company.com" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="providerType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Provider Type *</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select provider type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {Object.entries(PROVIDER_TYPE_CONFIG).map(([key, config]) => (
                                  <SelectItem key={key} value={key}>{config.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="employmentType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Employment Type</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="w2">W-2 Employee</SelectItem>
                                <SelectItem value="1099">1099 Contractor</SelectItem>
                                <SelectItem value="agency">Agency</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {requiresNPI && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="npiNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>NPI Number</FormLabel>
                              <FormControl>
                                <Input placeholder="1234567890" maxLength={10} {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="primarySpecialty"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Primary Specialty</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Psychiatry" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="phoneNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input placeholder="(555) 123-4567" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="minPatientAge"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Minimum Patient Age</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="1.5">1.5+ years</SelectItem>
                                <SelectItem value="13">13+ years</SelectItem>
                                <SelectItem value="17">17+ years</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="bio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bio</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Professional background and specialties..." rows={3} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="border-t pt-4">
                      <FormField
                        control={form.control}
                        name="createAccount"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between">
                            <div>
                              <FormLabel className="font-medium">Create Login Account</FormLabel>
                              <FormDescription className="text-xs mt-1">
                                Create an authentication account so this provider can log in. A temporary password will be generated.
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => navigate('/providers')}>Cancel</Button>
                      <Button type="button" onClick={handleNextFromDetails}>
                        {requiresLicensure ? 'Next: Select States' : 'Next: Review'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Step: States */}
              {step === 'states' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Licensed States</CardTitle>
                    <CardDescription>Select the states where {values.fullName || 'this provider'} is or will be licensed.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <StateSelectionStep
                      selectedStates={values.selectedStates}
                      onUpdate={states => form.setValue('selectedStates', states, { shouldDirty: true })}
                      providerType={values.providerType as ProviderType || null}
                      showPendingOption={false}
                    />

                    <div className="flex justify-between pt-4">
                      <Button type="button" variant="outline" onClick={() => setStep('details')}>Back</Button>
                      <Button type="button" onClick={() => setStep('review')}>
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
                        <p className="font-medium">{values.fullName}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground text-xs">Email</Label>
                        <p className="font-medium">{values.email}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground text-xs">Provider Type</Label>
                        <p className="font-medium">
                          {values.providerType ? PROVIDER_TYPE_CONFIG[values.providerType as ProviderType]?.label : '—'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground text-xs">Employment Type</Label>
                        <p className="font-medium">{values.employmentType || '—'}</p>
                      </div>
                      {values.npiNumber && (
                        <div>
                          <Label className="text-muted-foreground text-xs">NPI</Label>
                          <p className="font-medium">{values.npiNumber}</p>
                        </div>
                      )}
                      {values.selectedStates.length > 0 && (
                        <div className="md:col-span-2">
                          <Label className="text-muted-foreground text-xs">States</Label>
                          <p className="font-medium">{values.selectedStates.join(', ')}</p>
                        </div>
                      )}
                      <div>
                        <Label className="text-muted-foreground text-xs">Login Account</Label>
                        <p className="font-medium">{values.createAccount ? 'Will be created' : 'Not creating (profile only)'}</p>
                      </div>
                    </div>

                    <div className="flex justify-between pt-4 border-t">
                      <Button type="button" variant="outline" onClick={() => setStep(requiresLicensure ? 'states' : 'details')}>
                        Back
                      </Button>
                      <Button type="submit" disabled={createProviderMutation.isPending}>
                        {createProviderMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Create Provider
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </form>
          </Form>
        </div>
      </main>
    </div>
  );
}
