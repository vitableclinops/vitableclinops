import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

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

export const ProviderDetailModal = ({ provider, onClose }: ProviderDetailModalProps) => {
  if (!provider) return null;

  const fullAddress = [
    provider.address_line_1,
    provider.address_line_2,
    provider.address_city,
    provider.address_state,
    provider.postal_code,
  ].filter(Boolean).join(', ') || provider.home_address;

  return (
    <Dialog open={!!provider} onOpenChange={onClose}>
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
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="professional" className="mt-4">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="professional">Professional</TabsTrigger>
            <TabsTrigger value="licenses">Licenses</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
          </TabsList>

          <TabsContent value="professional" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <InfoRow label="Email" value={provider.email} />
              <InfoRow label="Phone" value={provider.phone_number} />
              <InfoRow label="NPI" value={provider.npi_number} />
              <InfoRow label="Profession" value={provider.profession} />
              <InfoRow label="CAQH Number" value={provider.caqh_number} />
              <InfoRow label="Medallion ID" value={provider.medallion_id} />
            </div>
            
            <Separator />
            
            <div className="space-y-4">
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
            </div>
            
            <Separator />
            
            <div className="grid grid-cols-3 gap-4">
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
            </div>
          </TabsContent>

          <TabsContent value="licenses" className="mt-4 space-y-4">
            <InfoRow label="Actively Licensed States" value={provider.actively_licensed_states} />
            <p className="text-sm text-muted-foreground">
              View the Licenses tab on the provider's profile for detailed license information.
            </p>
          </TabsContent>

          <TabsContent value="personal" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <InfoRow label="Full Legal Name" value={[provider.first_name, provider.middle_name, provider.last_name].filter(Boolean).join(' ') || provider.full_name} />
              <InfoRow label="Preferred Name" value={provider.preferred_name} />
              <InfoRow label="Pronouns" value={provider.pronoun} />
              <InfoRow label="Birthday" value={formatDate(provider.birthday)} />
              <InfoRow label="Secondary Email" value={provider.secondary_contact_email} />
            </div>
            
            <Separator />
            
            <InfoRow label="Home Address" value={fullAddress} />
            
            <Separator />
            
            <div className="grid grid-cols-2 gap-4">
              <InfoRow label="Emergency Contact" value={provider.emergency_contact_name} />
              <InfoRow label="Emergency Phone" value={provider.emergency_contact_phone} />
            </div>
          </TabsContent>

          <TabsContent value="employment" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
