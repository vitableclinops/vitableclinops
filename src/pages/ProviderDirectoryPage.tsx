import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from '@/components/AppSidebar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Search, Users, Grid3X3, List, MapPin, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

// Type for the public directory view (limited fields for non-admins)
interface DirectoryProvider {
  id: string;
  full_name: string | null;
  preferred_name: string | null;
  npi_number: string | null;
  credentials: string | null;
  avatar_url: string | null;
  employment_status: string | null;
  states: string | null;
}

// Type for the full profile (admin view)
interface FullProvider {
  id: string;
  user_id: string;
  full_name: string | null;
  preferred_name: string | null;
  email: string;
  phone_number: string | null;
  npi_number: string | null;
  credentials: string | null;
  avatar_url: string | null;
  birthday: string | null;
  home_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  patient_age_preference: string | null;
  service_offerings: string | null;
  employment_start_date: string | null;
  employment_end_date: string | null;
  employment_status: string | null;
  created_at: string;
}

const ProviderDirectoryPage = () => {
  const { profile, roles } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [providers, setProviders] = useState<(DirectoryProvider | FullProvider)[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<FullProvider | null>(null);

  const isAdmin = roles.includes('admin');
  const userRole = roles[0] || 'provider';
  const userName = profile?.full_name || profile?.email || 'User';
  const userEmail = profile?.email || '';

  useEffect(() => {
    const fetchProviders = async () => {
      setLoading(true);
      
      if (isAdmin) {
        // Admins get full profile data
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('full_name', { ascending: true });

        if (!error && data) {
          setProviders(data as FullProvider[]);
        }
      } else {
        // Non-admins get the limited public view
        const { data, error } = await supabase
          .from('provider_directory_public')
          .select('*')
          .order('full_name', { ascending: true });

        if (!error && data) {
          setProviders(data as DirectoryProvider[]);
        }
      }
      
      setLoading(false);
    };

    fetchProviders();
  }, [isAdmin]);

  const filteredProviders = providers.filter(p => {
    const query = searchQuery.toLowerCase();
    const name = (p.full_name || '').toLowerCase();
    const preferredName = (p.preferred_name || '').toLowerCase();
    const credentials = (p.credentials || '').toLowerCase();
    
    return name.includes(query) || preferredName.includes(query) || credentials.includes(query);
  });

  const getInitials = (name: string | null) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getDisplayName = (provider: DirectoryProvider | FullProvider) => {
    return provider.preferred_name || provider.full_name || 'Unknown';
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

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole as any}
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={profile?.avatar_url || undefined}
      />

      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Provider Directory</h1>
                <p className="text-muted-foreground">
                  {isAdmin ? 'Full provider directory with all details' : 'View your colleagues'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setViewMode('grid')}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className="relative max-w-md mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or credentials..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mb-6 text-sm text-muted-foreground">
            <span>{filteredProviders.length} provider{filteredProviders.length !== 1 ? 's' : ''}</span>
            {isAdmin && (
              <>
                <span>•</span>
                <span>{providers.filter(p => p.employment_status === 'active').length} active</span>
              </>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-full bg-muted" />
                      <div className="space-y-2">
                        <div className="h-4 w-32 bg-muted rounded" />
                        <div className="h-3 w-24 bg-muted rounded" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProviders.map(provider => (
                <Card 
                  key={provider.id} 
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => isAdmin && setSelectedProvider(provider as FullProvider)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={provider.avatar_url || undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {getInitials(provider.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-foreground truncate">
                            {getDisplayName(provider)}
                          </h3>
                          {isAdmin && getStatusBadge(provider.employment_status)}
                        </div>
                        {provider.credentials && (
                          <p className="text-sm text-muted-foreground">{provider.credentials}</p>
                        )}
                        {provider.npi_number && (
                          <p className="text-xs text-muted-foreground mt-1">NPI: {provider.npi_number}</p>
                        )}
                        {'states' in provider && provider.states && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">{provider.states}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Credentials</TableHead>
                    <TableHead>NPI</TableHead>
                    {'states' in (providers[0] || {}) && <TableHead>States</TableHead>}
                    {isAdmin && <TableHead>Status</TableHead>}
                    {isAdmin && <TableHead>Email</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProviders.map(provider => (
                    <TableRow 
                      key={provider.id}
                      className={isAdmin ? 'cursor-pointer hover:bg-muted/50' : ''}
                      onClick={() => isAdmin && setSelectedProvider(provider as FullProvider)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={provider.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {getInitials(provider.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{getDisplayName(provider)}</span>
                        </div>
                      </TableCell>
                      <TableCell>{provider.credentials || '-'}</TableCell>
                      <TableCell>{provider.npi_number || '-'}</TableCell>
                      {'states' in provider && <TableCell>{provider.states || '-'}</TableCell>}
                      {isAdmin && <TableCell>{getStatusBadge(provider.employment_status)}</TableCell>}
                      {isAdmin && 'email' in provider && (
                        <TableCell className="text-muted-foreground">
                          {provider.email}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      </main>

      {/* Admin Detail Modal */}
      {isAdmin && selectedProvider && (
        <Dialog open={!!selectedProvider} onOpenChange={() => setSelectedProvider(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selectedProvider.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {getInitials(selectedProvider.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <span>{getDisplayName(selectedProvider)}</span>
                  {selectedProvider.credentials && (
                    <span className="text-muted-foreground font-normal">, {selectedProvider.credentials}</span>
                  )}
                </div>
              </DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="professional" className="mt-4">
              <TabsList className="w-full">
                <TabsTrigger value="professional" className="flex-1">Professional</TabsTrigger>
                <TabsTrigger value="personal" className="flex-1">Personal</TabsTrigger>
                <TabsTrigger value="employment" className="flex-1">Employment</TabsTrigger>
              </TabsList>

              <TabsContent value="professional" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium">{selectedProvider.email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="font-medium">{selectedProvider.phone_number || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">NPI Number</p>
                    <p className="font-medium">{selectedProvider.npi_number || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Credentials</p>
                    <p className="font-medium">{selectedProvider.credentials || '-'}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Patient Age Preference</p>
                  <p className="font-medium">{selectedProvider.patient_age_preference || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Service Offerings</p>
                  <p className="font-medium">{selectedProvider.service_offerings || '-'}</p>
                </div>
              </TabsContent>

              <TabsContent value="personal" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Full Name</p>
                    <p className="font-medium">{selectedProvider.full_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Preferred Name</p>
                    <p className="font-medium">{selectedProvider.preferred_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Birthday</p>
                    <p className="font-medium">
                      {selectedProvider.birthday
                        ? format(new Date(selectedProvider.birthday), 'MMMM d, yyyy')
                        : '-'}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Home Address</p>
                  <p className="font-medium">{selectedProvider.home_address || '-'}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Emergency Contact</p>
                    <p className="font-medium">{selectedProvider.emergency_contact_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Emergency Phone</p>
                    <p className="font-medium">{selectedProvider.emergency_contact_phone || '-'}</p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="employment" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Employment Status</p>
                    <div className="mt-1">{getStatusBadge(selectedProvider.employment_status)}</div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Start Date</p>
                    <p className="font-medium">
                      {selectedProvider.employment_start_date
                        ? format(new Date(selectedProvider.employment_start_date), 'MMMM d, yyyy')
                        : '-'}
                    </p>
                  </div>
                  {selectedProvider.employment_status === 'termed' && (
                    <div>
                      <p className="text-xs text-muted-foreground">End Date</p>
                      <p className="font-medium">
                        {selectedProvider.employment_end_date
                          ? format(new Date(selectedProvider.employment_end_date), 'MMMM d, yyyy')
                          : '-'}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Profile Created</p>
                    <p className="font-medium">
                      {format(new Date(selectedProvider.created_at), 'MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default ProviderDirectoryPage;
