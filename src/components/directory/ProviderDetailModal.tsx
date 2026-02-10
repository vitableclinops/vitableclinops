import { useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, ExternalLink, Pencil, Save, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  credentials: string | null;
  profession: string | null;
  avatar_url: string | null;
  birthday: string | null;
  home_address: string | null;
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
  primary_specialty: string | null;
  board_certificates: string | null;
  caqh_number: string | null;
  pronoun: string | null;
  has_caqh_management: boolean | null;
  has_collaborative_agreements: boolean | null;
  auto_renew_licenses: boolean | null;
  practice_restrictions: string | null;
  secondary_contact_email: string | null;
  actively_licensed_states: string | null;
  medallion_id: string | null;
  chart_review_folder_url: string | null;
  created_at: string;
}

interface ProviderDetailModalProps {
  provider: FullProvider | null;
  onClose: () => void;
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

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  try {
    return format(new Date(dateStr), 'MMMM d, yyyy');
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

export const ProviderDetailModal = ({ provider, onClose }: ProviderDetailModalProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!provider) return;
      const { error } = await supabase
        .from('profiles')
        .update(formData)
        .eq('id', provider.id);
      if (error) throw error;
    },
    onSuccess: () => {
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
      employment_offer_date: provider.employment_offer_date,
      employment_start_date: provider.employment_start_date,
      employment_end_date: provider.employment_end_date,
      has_caqh_management: provider.has_caqh_management,
      has_collaborative_agreements: provider.has_collaborative_agreements,
      auto_renew_licenses: provider.auto_renew_licenses,
      chart_review_folder_url: provider.chart_review_folder_url,
      actively_licensed_states: provider.actively_licensed_states,
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
    provider.address_state,
    provider.postal_code,
  ].filter(Boolean).join(', ') || provider.home_address;

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

        <Tabs defaultValue="professional" className="mt-4">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="professional">Professional</TabsTrigger>
            <TabsTrigger value="licenses">Licenses</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
          </TabsList>

          {/* Professional Tab */}
          <TabsContent value="professional" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {isEditing ? (
                <>
                  <EditableField label="Email" value={formData.email} field="email" onChange={handleChange} type="email" />
                  <EditableField label="Phone" value={formData.phone_number} field="phone_number" onChange={handleChange} type="tel" />
                  <EditableField label="NPI" value={formData.npi_number} field="npi_number" onChange={handleChange} />
                  <EditableField label="Profession" value={formData.profession} field="profession" onChange={handleChange} />
                  <EditableField label="CAQH Number" value={formData.caqh_number} field="caqh_number" onChange={handleChange} />
                  <EditableField label="Medallion ID" value={formData.medallion_id} field="medallion_id" onChange={handleChange} />
                </>
              ) : (
                <>
                  <InfoRow label="Email" value={provider.email} />
                  <InfoRow label="Phone" value={provider.phone_number} />
                  <InfoRow label="NPI" value={provider.npi_number} />
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Collab Agreements</span>
                    <Switch checked={!!formData.has_collaborative_agreements} onCheckedChange={(v) => handleChange('has_collaborative_agreements', v)} />
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
                    <Badge variant={provider.has_collaborative_agreements ? 'default' : 'secondary'}>
                      {provider.has_collaborative_agreements ? 'Yes' : 'No'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">Collab Agreements</span>
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

          {/* Licenses Tab */}
          <TabsContent value="licenses" className="mt-4 space-y-4">
            {isEditing ? (
              <>
                <EditableField label="Actively Licensed States" value={formData.actively_licensed_states} field="actively_licensed_states" onChange={handleChange} />
                <EditableField label="Chart Review Folder URL" value={formData.chart_review_folder_url} field="chart_review_folder_url" onChange={handleChange} />
              </>
            ) : (
              <>
                <InfoRow label="Actively Licensed States" value={provider.actively_licensed_states} />
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
                  <EditableField label="Offer Date" value={formData.employment_offer_date} field="employment_offer_date" onChange={handleChange} type="date" />
                  <EditableField label="Start Date" value={formData.employment_start_date} field="employment_start_date" onChange={handleChange} type="date" />
                  <EditableField label="End Date" value={formData.employment_end_date} field="employment_end_date" onChange={handleChange} type="date" />
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Employment Status</p>
                    {getStatusBadge(provider.employment_status)}
                  </div>
                  <InfoRow label="Offer Date" value={formatDate(provider.employment_offer_date)} />
                  <InfoRow label="Start Date" value={formatDate(provider.employment_start_date)} />
                  {provider.employment_status === 'termed' && (
                    <InfoRow label="End Date" value={formatDate(provider.employment_end_date)} />
                  )}
                  <InfoRow label="Profile Created" value={formatDate(provider.created_at)} />
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
