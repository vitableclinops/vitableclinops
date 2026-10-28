import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAgencies } from '@/hooks/useAgencies';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MedallionProviderSection } from '@/components/directory/MedallionProviderSection';
import { activeLicensedStates, useMedallionDirectoryData } from '@/hooks/useMedallionDirectory';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, ExternalLink, Pencil, Save, X, Link2, AlertTriangle, Upload, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

const PROFESSION_OPTIONS = [
  'NP',
  'RN',
  'MD',
  'DO',
  'LPC',
  'LCSW',
  'LMFT',
  'Psychologist',
  'Mental Health Coach',
  'Other',
] as const;

interface FullProvider {
  id: string;
  user_id: string | null;
  full_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string;
  phone_number: string | null;
  npi_number: string | null;
  admin_no_npi?: boolean;
  credentials: string | null;
  profession: string | null;
  avatar_url: string | null;
  birthday: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  postal_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  patient_age_preference: string | null;
  service_offerings: string | null;
  employment_start_date: string | null;
  employment_end_date: string | null;
  employment_offer_date: string | null;
  employment_status: string | null;
  employment_type: string | null;
  agency_id: string | null;
  primary_specialty: string | null;
  board_certificates: string | null;
  caqh_number: string | null;
  pronoun: string | null;
  has_caqh_management: boolean | null;
  has_collaborative_agreements: boolean | null;
  auto_renew_licenses: boolean | null;
  practice_restrictions: string | null;
  secondary_contact_email: string | null;
  medallion_id: string | null;
  chart_review_folder_url: string | null;
  created_at: string;
  activation_status: string | null;
  renewal_handling: string | null;
  languages: string | null;
  bio: string | null;
  pod_lead_id: string | null;
}

interface ProviderDetailModalProps {
  provider: FullProvider | null;
  onClose: () => void;
  onSaved?: (provider: FullProvider) => void;
}

const getInitials = (name: string | null) => {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

const getStatusBadge = (status: string | null) => {
  switch (status) {
    case 'active':
      return <Badge className="bg-success/10 text-success">Active</Badge>;
    case 'inactive':
      return <Badge variant="secondary">Inactive</Badge>;
    case 'termed':
      return <Badge variant="destructive">Terminated</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
};

/** Parse a YYYY-MM-DD string as a local date to avoid UTC timezone shift */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  try {
    return format(parseLocalDate(dateStr), 'MMMM d, yyyy');
  } catch {
    return dateStr;
  }
};

const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
    <p className="font-medium text-sm">{value || '-'}</p>
  </div>
);

const EditableField = ({
  label,
  value,
  field,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | null;
  field: string;
  onChange: (field: string, value: string) => void;
  type?: 'text' | 'date' | 'email' | 'tel' | 'textarea';
}) => (
  <div>
    <p className="text-xs text-muted-foreground mb-1">{label}</p>
    {type === 'textarea' ? (
      <Textarea
        value={value || ''}
        onChange={(e) => onChange(field, e.target.value)}
        className="text-sm h-20"
      />
    ) : (
      <Input
        type={type}
        value={value || ''}
        onChange={(e) => onChange(field, e.target.value)}
        className="text-sm h-8"
      />
    )}
  </div>
);

export const ProviderDetailModal = ({ provider, onClose, onSaved }: ProviderDetailModalProps) => {
  const { data: medallionData } = useMedallionDirectoryData(!!provider);
  const medallionStates = provider ? activeLicensedStates(medallionData?.licensesByProfile.get(provider.id)) : [];
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [uploadTarget, setUploadTarget] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { hasRole } = useAuth();
  const isAdminUser = hasRole('admin');
  const [activationOverride, setActivationOverride] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  if (provider && overrideFor !== provider.id) { setOverrideFor(provider.id); setActivationOverride(null); }
  const clearAgreementFlag = useMutation({
    mutationFn: async () => {
      if (!provider) return;
      const { error } = await supabase.from('profiles')
        .update({ activation_status: 'ready', has_collaborative_agreements: true }).eq('id', provider.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setActivationOverride('ready');
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['provider-directory'] });
      toast({ title: 'Activation updated', description: 'Pending Agreements flag cleared.' });
    },
    onError: (e: Error) => toast({ title: 'Could not update', description: e.message, variant: 'destructive' }),
  });

  // Upload a signed agreement document straight from the missing-docs banner.
  // Stores the file in the task-documents bucket and links it on the agreement,
  // which clears the "missing doc" flag (same field the agreements page checks).
  const handleAgreementDocUpload = async (file: File) => {
    if (!uploadTarget) return;
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${uploadTarget.id}/agreement-doc/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from('task-documents')
        .upload(storagePath, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = await supabase.storage
        .from('task-documents')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10); // 10-year URL
      const docUrl = urlData?.signedUrl || storagePath;

      const { error: updateError } = await supabase
        .from('collaborative_agreements')
        .update({ agreement_document_url: docUrl })
        .eq('id', uploadTarget.id);
      if (updateError) throw updateError;

      await supabase.from('agreement_audit_log').insert({
        entity_type: 'agreement',
        entity_id: uploadTarget.id,
        action: 'document_uploaded',
        changes: { file_name: file.name, source: 'provider_directory' },
        performed_by: user?.id || null,
        performed_by_name: profile?.full_name || user?.email || 'Unknown',
      });

      toast({
        title: 'Document uploaded',
        description: `${uploadTarget.state_abbreviation} agreement now has documentation on file.`,
      });
      setUploadTarget(null);
      queryClient.invalidateQueries({ queryKey: ['provider-missing-requirements', provider?.id] });
      queryClient.invalidateQueries({ queryKey: ['agreements'] });
    } catch (err: any) {
      console.error('Agreement doc upload error:', err);
      toast({ title: 'Upload failed', description: err.message || 'Could not upload the document.', variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const { agencies } = useAgencies();

  // Fetch pod leads (profiles with pod_lead role)
  const { data: podLeads = [] } = useQuery({
    queryKey: ['pod-leads'],
    queryFn: async () => {
      // First get all user IDs with pod_lead role
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'pod_lead');
      
      if (roleError) throw roleError;
      
      const podLeadUserIds = (roleData || []).map(r => r.user_id);
      
      if (podLeadUserIds.length === 0) return [];
      
      // Then get profiles for those user IDs
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('user_id', podLeadUserIds)
        .not('full_name', 'is', null)
        .order('full_name');
      
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch actual collaborative agreement count for this provider
  const { data: agreementCount = 0 } = useQuery({
    queryKey: ['provider-agreements-count', provider?.id],
    queryFn: async () => {
      if (!provider) return 0;
      const { count, error } = await supabase
        .from('agreement_providers')
        .select('*', { count: 'exact', head: true })
        .eq('provider_id', provider.id)
        .eq('is_active', true);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!provider,
  });

  // Fetch this provider's active agreements to surface missing requirements
  // (currently: agreements with no documentation on file — same rule as the
  // "Missing Docs" status square on the agreements page).
  const { data: missingDocAgreements = [] } = useQuery({
    queryKey: ['provider-missing-requirements', provider?.id],
    queryFn: async () => {
      if (!provider) return [];
      const { data, error } = await supabase
        .from('agreement_providers')
        .select('agreement_id, collaborative_agreements(id, state_abbreviation, physician_name, workflow_status, agreement_document_url, medallion_document_url)')
        .eq('provider_id', provider.id)
        .eq('is_active', true);
      if (error) throw error;
      return (data || [])
        .map((row: any) => row.collaborative_agreements)
        .filter((a: any) => a && a.workflow_status === 'active' && !a.agreement_document_url && !a.medallion_document_url);
    },
    enabled: !!provider,
  });

  // Fetch this provider's invalid agreements with the reason each was
  // invalidated, from the agreement audit log (action 'auto_invalidated').
  const { data: invalidAgreements = [] } = useQuery({
    queryKey: ['provider-invalid-agreements', provider?.id],
    queryFn: async () => {
      if (!provider) return [];
      const { data: links, error: linkError } = await supabase
        .from('agreement_providers')
        .select('agreement_id, collaborative_agreements(id, state_abbreviation, physician_name, workflow_status)')
        .eq('provider_id', provider.id);
      if (linkError) throw linkError;
      const invalid = (links || [])
        .map((row: any) => row.collaborative_agreements)
        .filter((a: any) => a && a.workflow_status === 'invalid');
      if (invalid.length === 0) return [];
      const ids = invalid.map((a: any) => a.id);
      const { data: logs, error: logError } = await supabase
        .from('agreement_audit_log')
        .select('entity_id, action, changes, created_at')
        .eq('entity_type', 'agreement')
        .in('entity_id', ids)
        .order('created_at', { ascending: false });
      if (logError) throw logError;
      return invalid.map((a: any) => {
        const entry = (logs || []).find((l: any) => l.entity_id === a.id && l.action === 'auto_invalidated');
        return {
          ...a,
          reason: (entry?.changes as any)?.reason || null,
          invalidatedAt: entry?.created_at || null,
        };
      });
    },
    enabled: !!provider,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!provider) return;
      // Exclude computed field from save
      const { has_collaborative_agreements: _, ...saveData } = formData;
      const { error } = await supabase
        .from('profiles')
        .update({ ...saveData, has_collaborative_agreements: agreementCount > 0 })
        .eq('id', provider.id)
        .select('*')
        .single();
      if (error) throw error;
      return { ...provider, ...saveData, has_collaborative_agreements: agreementCount > 0 } as FullProvider;
    },
    onSuccess: (saved) => {
      if (saved) onSaved?.(saved);
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['provider-directory'] });
      toast({ title: 'Profile updated', description: 'Provider profile saved successfully.' });
      setIsEditing(false);
    },
    onError: (error) => {
      toast({ title: 'Error saving', description: error.message, variant: 'destructive' });
    },
  });

  if (!provider) return null;

  const startEditing = () => {
    setFormData({
      full_name: provider.full_name,
      first_name: provider.first_name,
      middle_name: provider.middle_name,
      last_name: provider.last_name,
      preferred_name: provider.preferred_name,
      email: provider.email,
      phone_number: provider.phone_number,
      npi_number: provider.npi_number,
      admin_no_npi: provider.admin_no_npi ?? false,
      credentials: provider.credentials,
      profession: provider.profession,
      caqh_number: provider.caqh_number,
      medallion_id: provider.medallion_id,
      board_certificates: provider.board_certificates,
      patient_age_preference: provider.patient_age_preference,
      service_offerings: provider.service_offerings,
      practice_restrictions: provider.practice_restrictions,
      primary_specialty: provider.primary_specialty,
      pronoun: provider.pronoun,
      birthday: provider.birthday,
      secondary_contact_email: provider.secondary_contact_email,
      address_line_1: provider.address_line_1,
      address_line_2: provider.address_line_2,
      address_city: provider.address_city,
      address_state: provider.address_state,
      postal_code: provider.postal_code,
      emergency_contact_name: provider.emergency_contact_name,
      emergency_contact_phone: provider.emergency_contact_phone,
      employment_status: provider.employment_status,
      employment_type: provider.employment_type,
      agency_id: provider.agency_id,
      employment_offer_date: provider.employment_offer_date,
      employment_start_date: provider.employment_start_date,
      employment_end_date: provider.employment_end_date,
      has_caqh_management: provider.has_caqh_management,
      has_collaborative_agreements: provider.has_collaborative_agreements,
      auto_renew_licenses: provider.auto_renew_licenses,
      chart_review_folder_url: provider.chart_review_folder_url,
      pod_lead_id: provider.pod_lead_id,
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setFormData({});
  };

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value || null }));
  };


  const val = (field: string) => isEditing ? (formData[field] ?? '') : (provider as any)[field];

  const fullAddress = [
    provider.address_line_1,
    provider.address_line_2,
    provider.address_city,
  ].filter(Boolean).join(', ');

  return (
    <Dialog open={!!provider} onOpenChange={() => { cancelEditing(); onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4">
            <Avatar className="h-12 w-12">
              <AvatarImage src={provider.avatar_url || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary">
                {getInitials(provider.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xl">{provider.preferred_name || provider.full_name}</span>
                {provider.credentials && (
                  <Badge variant="outline">{provider.credentials}</Badge>
                )}
                {getStatusBadge(provider.employment_status)}
              </div>
              {provider.primary_specialty && (
                <p className="text-sm text-muted-foreground">{provider.primary_specialty}</p>
              )}
            </div>
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button size="sm" variant="ghost" onClick={cancelEditing}>
                    <X className="h-4 w-4 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                    <Save className="h-4 w-4 mr-1" /> Save
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={startEditing}>
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {missingDocAgreements.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <span className="font-medium">Missing requirements:</span>{' '}
              <span className="text-muted-foreground">
                No documentation on file for {missingDocAgreements.length} active agreement{missingDocAgreements.length > 1 ? 's' : ''}
                {' '}— click one to upload the document:
              </span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {missingDocAgreements.map((a: any) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setUploadTarget(a)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-background px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 transition-colors"
                  >
                    <Upload className="h-3 w-3" />
                    {a.state_abbreviation} ({a.physician_name || 'Unassigned'})
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {invalidAgreements.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-sm space-y-1.5">
              <span className="font-medium">
                {invalidAgreements.length} invalid agreement{invalidAgreements.length > 1 ? 's' : ''}
              </span>
              <ul className="list-disc pl-4 text-muted-foreground space-y-1">
                {invalidAgreements.map((a: any) => (
                  <li key={a.id}>
                    <span className="font-medium text-foreground">{a.state_abbreviation} ({a.physician_name || 'Unassigned'})</span>
                    {' '}— {a.reason || 'Marked invalid by the nightly agreement check (no reason recorded).'}
                    {a.invalidatedAt && (
                      <span className="block text-xs">
                        Flagged {new Date(a.invalidatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <Tabs defaultValue="professional" className="mt-4">
          <TabsList className="w-full grid grid-cols-6">
            <TabsTrigger value="professional">Professional</TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="licenses">Licenses</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
            <TabsTrigger value="medallion">Medallion</TabsTrigger>
          </TabsList>

          <TabsContent value="medallion" className="mt-4">
            <MedallionProviderSection profileId={provider.id} medallionId={provider.medallion_id} />
          </TabsContent>

          {/* Professional Tab */}
          <TabsContent value="professional" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {isEditing ? (
                <>
                  <EditableField label="Email" value={formData.email} field="email" onChange={handleChange} type="email" />
                  <EditableField label="Phone" value={formData.phone_number} field="phone_number" onChange={handleChange} type="tel" />
                  <EditableField label="NPI" value={formData.npi_number} field="npi_number" onChange={handleChange} />
                  {isAdminUser && (
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="admin-no-npi" className="text-sm text-muted-foreground">Admin: no NPI</label>
                      <Switch id="admin-no-npi" checked={!!formData.admin_no_npi} onCheckedChange={value => setFormData(prev => ({ ...prev, admin_no_npi: value }))} />
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Profession</p>
                    <Select value={formData.profession || ''} onValueChange={(v) => handleChange('profession', v)}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select profession" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROFESSION_OPTIONS.map(p => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <EditableField label="CAQH Number" value={formData.caqh_number} field="caqh_number" onChange={handleChange} />
                  <EditableField label="Medallion ID" value={formData.medallion_id} field="medallion_id" onChange={handleChange} />
                </>
              ) : (
                <>
                  <InfoRow label="Email" value={provider.email} />
                  <InfoRow label="Phone" value={provider.phone_number} />
                  <InfoRow label="NPI" value={provider.npi_number} />
                  {provider.admin_no_npi && <InfoRow label="NPI review" value="Admin: no NPI" />}
                  <InfoRow label="Profession" value={provider.profession} />
                  <InfoRow label="CAQH Number" value={provider.caqh_number} />
                  <InfoRow label="Medallion ID" value={provider.medallion_id} />
                </>
              )}
            </div>
            
            <Separator />
            
            <div className="space-y-4">
              {isEditing ? (
                <>
                  <EditableField label="Board Certificates" value={formData.board_certificates} field="board_certificates" onChange={handleChange} type="textarea" />
                  <EditableField label="Patient Age Preference" value={formData.patient_age_preference} field="patient_age_preference" onChange={handleChange} />
                  <EditableField label="Service Offerings" value={formData.service_offerings} field="service_offerings" onChange={handleChange} type="textarea" />
                  <EditableField label="Practice Restrictions" value={formData.practice_restrictions} field="practice_restrictions" onChange={handleChange} type="textarea" />
                </>
              ) : (
                <>
                  <InfoRow label="Board Certificates" value={provider.board_certificates} />
                  <InfoRow label="Patient Age Preference" value={provider.patient_age_preference} />
                  <InfoRow label="Service Offerings" value={provider.service_offerings} />
                  {provider.practice_restrictions && (
                    <Card className="border-amber-200 bg-amber-50/50">
                      <CardContent className="p-3">
                        <p className="text-xs text-amber-700 font-medium mb-1">Practice Restrictions</p>
                        <p className="text-sm text-amber-900">{provider.practice_restrictions}</p>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
            
            <Separator />
            
            <div className="grid grid-cols-3 gap-4">
              {isEditing ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">CAQH Managed</span>
                    <Switch checked={!!formData.has_caqh_management} onCheckedChange={(v) => handleChange('has_caqh_management', v)} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Collab Agreements</span>
                    <Badge variant={agreementCount > 0 ? 'default' : 'secondary'}>
                      {agreementCount > 0 ? `${agreementCount} active` : 'None'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Auto-Renew</span>
                    <Switch checked={!!formData.auto_renew_licenses} onCheckedChange={(v) => handleChange('auto_renew_licenses', v)} />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant={provider.has_caqh_management ? 'default' : 'secondary'}>
                      {provider.has_caqh_management ? 'Yes' : 'No'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">CAQH Managed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                    <Badge variant={agreementCount > 0 ? 'default' : 'secondary'}>
                      {agreementCount > 0 ? `${agreementCount} active` : 'None'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">Collab Agreements</span>
                    {missingDocAgreements.length > 0 && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                        {missingDocAgreements.length} missing docs
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={provider.auto_renew_licenses ? 'default' : 'secondary'}>
                      {provider.auto_renew_licenses ? 'Yes' : 'No'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">Auto-Renew</span>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Overview Tab - Quick summary with enriched fields */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            {isAdminUser && (activationOverride ?? provider.activation_status) === 'pending_agreements' && agreementCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 p-3">
                <p className="text-sm">
                  Activation still says <strong>Pending Agreements</strong>, but {agreementCount} agreement{agreementCount === 1 ? ' is' : 's are'} on file.
                </p>
                <Button size="sm" onClick={() => clearAgreementFlag.mutate()} disabled={clearAgreementFlag.isPending}>
                  Mark agreements done
                </Button>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <InfoRow label="Activation Status" value={(() => {
                const s = activationOverride ?? provider.activation_status;
                return s === 'ready' ? 'Ready' :
                  s === 'pending_onboarding' ? 'Pending Onboarding' :
                  s === 'pending_agreements' ? 'Pending Agreements' :
                  s || 'Not Set';
              })()} />
              <InfoRow label="Collaborative Physician" value={null} />
              <InfoRow label="Renewal Handling" value={
                provider.renewal_handling === 'self' ? 'Self-Managed' :
                provider.renewal_handling === 'medallion' ? 'Medallion-Managed' :
                provider.renewal_handling === 'internal' ? 'Internal Admin' :
                provider.renewal_handling || 'Not Set'
              } />
              <InfoRow label="Languages" value={provider.languages} />
              <InfoRow label="Licensed States" value={medallionStates.length ? medallionStates.join(', ') : null} />
              <InfoRow label="Home State" value={provider.address_state} />
            </div>
            {provider.bio && (
              <>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Bio</p>
                  <p className="text-sm">{provider.bio}</p>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="licenses" className="mt-4 space-y-4">
            {isEditing ? (
              <>
                <EditableField label="Chart Review Folder URL" value={formData.chart_review_folder_url} field="chart_review_folder_url" onChange={handleChange} />
              </>
            ) : (
              <>
                {/* Licensed states now derived from provider_state_status */}
                {provider.chart_review_folder_url && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">Chart Reviews:</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => window.open(provider.chart_review_folder_url!, '_blank')}
                    >
                      <FileText className="h-4 w-4" />
                      Open Folder
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  View the Licenses tab on the provider's profile for detailed license information.
                </p>
              </>
            )}
          </TabsContent>

          {/* Personal Tab */}
          <TabsContent value="personal" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {isEditing ? (
                <>
                  <EditableField label="First Name" value={formData.first_name} field="first_name" onChange={handleChange} />
                  <EditableField label="Middle Name" value={formData.middle_name} field="middle_name" onChange={handleChange} />
                  <EditableField label="Last Name" value={formData.last_name} field="last_name" onChange={handleChange} />
                  <EditableField label="Preferred Name" value={formData.preferred_name} field="preferred_name" onChange={handleChange} />
                  <EditableField label="Pronouns" value={formData.pronoun} field="pronoun" onChange={handleChange} />
                  <EditableField label="Birthday" value={formData.birthday} field="birthday" onChange={handleChange} type="date" />
                  <EditableField label="Secondary Email" value={formData.secondary_contact_email} field="secondary_contact_email" onChange={handleChange} type="email" />
                </>
              ) : (
                <>
                  <InfoRow label="Full Legal Name" value={[provider.first_name, provider.middle_name, provider.last_name].filter(Boolean).join(' ') || provider.full_name} />
                  <InfoRow label="Preferred Name" value={provider.preferred_name} />
                  <InfoRow label="Pronouns" value={provider.pronoun} />
                  <InfoRow label="Birthday" value={formatDate(provider.birthday)} />
                  <InfoRow label="Secondary Email" value={provider.secondary_contact_email} />
                </>
              )}
            </div>
            
            <Separator />
            
            {isEditing ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <EditableField label="Address Line 1" value={formData.address_line_1} field="address_line_1" onChange={handleChange} />
                <EditableField label="Address Line 2" value={formData.address_line_2} field="address_line_2" onChange={handleChange} />
                <EditableField label="City" value={formData.address_city} field="address_city" onChange={handleChange} />
                <EditableField label="State" value={formData.address_state} field="address_state" onChange={handleChange} />
                <EditableField label="Postal Code" value={formData.postal_code} field="postal_code" onChange={handleChange} />
              </div>
            ) : (
              <InfoRow label="Home Address" value={fullAddress} />
            )}
            
            <Separator />
            
            <div className="grid grid-cols-2 gap-4">
              {isEditing ? (
                <>
                  <EditableField label="Emergency Contact" value={formData.emergency_contact_name} field="emergency_contact_name" onChange={handleChange} />
                  <EditableField label="Emergency Phone" value={formData.emergency_contact_phone} field="emergency_contact_phone" onChange={handleChange} type="tel" />
                </>
              ) : (
                <>
                  <InfoRow label="Emergency Contact" value={provider.emergency_contact_name} />
                  <InfoRow label="Emergency Phone" value={provider.emergency_contact_phone} />
                </>
              )}
            </div>
          </TabsContent>

          {/* Employment Tab */}
          <TabsContent value="employment" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {isEditing ? (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Employment Status</p>
                    <Select value={formData.employment_status || ''} onValueChange={(v) => handleChange('employment_status', v)}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="termed">Terminated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Employment Type</p>
                    <Select
                      value={formData.employment_type || ''}
                      onValueChange={(v) => {
                        handleChange('employment_type', v);
                        if (v !== 'agency') handleChange('agency_id', null);
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="w2">Internal</SelectItem>
                        <SelectItem value="1099">1099 (Internal)</SelectItem>
                        <SelectItem value="agency">Agency-Supplied</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.employment_type === 'agency' && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Linked Agency</p>
                      <Select value={formData.agency_id || ''} onValueChange={(v) => handleChange('agency_id', v)}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select agency" />
                        </SelectTrigger>
                        <SelectContent>
                          {agencies.filter(a => a.is_active).map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <EditableField label="Offer Date" value={formData.employment_offer_date} field="employment_offer_date" onChange={handleChange} type="date" />
                  <EditableField label="Start Date" value={formData.employment_start_date} field="employment_start_date" onChange={handleChange} type="date" />
                   <EditableField label="End Date" value={formData.employment_end_date} field="employment_end_date" onChange={handleChange} type="date" />
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Pod Lead</p>
                    <Select value={formData.pod_lead_id || 'none'} onValueChange={(v) => handleChange('pod_lead_id', v === 'none' ? null : v)}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select pod lead" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {podLeads.map(pl => (
                          <SelectItem key={pl.id} value={pl.id}>{pl.full_name || pl.email}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Employment Status</p>
                    {getStatusBadge(provider.employment_status)}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Employment Type</p>
                    <Badge variant={provider.employment_type === 'agency' ? 'secondary' : 'outline'}>
                      {provider.employment_type === 'w2' ? 'Internal' : provider.employment_type === '1099' ? '1099' : provider.employment_type === 'agency' ? 'Agency-Supplied' : 'Not Set'}
                    </Badge>
                  </div>
                  {provider.employment_type === 'agency' && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Linked Agency</p>
                      <p className="font-medium text-sm">
                        {agencies.find(a => a.id === provider.agency_id)?.name || 'Unknown'}
                      </p>
                    </div>
                  )}
                  <InfoRow label="Offer Date" value={formatDate(provider.employment_offer_date)} />
                  <InfoRow label="Start Date" value={formatDate(provider.employment_start_date)} />
                  {provider.employment_status === 'termed' && (
                    <InfoRow label="End Date" value={formatDate(provider.employment_end_date)} />
                  )}
                   <InfoRow label="Profile Created" value={formatDate(provider.created_at)} />
                  <InfoRow label="Pod Lead" value={podLeads.find(pl => pl.id === provider.pod_lead_id)?.full_name || 'Not Assigned'} />
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>

      {/* Upload dialog for satisfying a missing-document requirement */}
      <Dialog open={!!uploadTarget} onOpenChange={(open) => { if (!open && !uploading) setUploadTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload agreement document</DialogTitle>
          </DialogHeader>
          {uploadTarget && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload the signed agreement document for{' '}
                <span className="font-medium text-foreground">
                  {uploadTarget.state_abbreviation} ({uploadTarget.physician_name || 'Unassigned'})
                </span>
                . This satisfies the missing documentation requirement.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleAgreementDocUpload(file);
                }}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" /> Choose file
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
