import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAgencies, Agency } from '@/hooks/useAgencies';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Building2, Plus, Edit, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const AgencyManagementPage = () => {
  const { profile, roles } = useAuth();
  const { agencies, loading, createAgency, updateAgency, refetch } = useAgencies();
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Agency | null>(null);
  const [providerCounts, setProviderCounts] = useState<Record<string, number>>({});

  // Form state
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName(''); setContactName(''); setContactEmail(''); setContactPhone(''); setNotes('');
    setEditing(null);
  };

  const openEdit = (agency: Agency) => {
    setEditing(agency);
    setName(agency.name);
    setContactName(agency.contact_name || '');
    setContactEmail(agency.contact_email || '');
    setContactPhone(agency.contact_phone || '');
    setNotes(agency.notes || '');
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!name) return;
    setSaving(true);
    try {
      const payload = {
        name,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        contact_phone: contactPhone || null,
        notes: notes || null,
      };
      if (editing) {
        await updateAgency(editing.id, payload);
      } else {
        await createAgency(payload);
      }
      setShowDialog(false);
      resetForm();
    } catch { /* handled */ }
    setSaving(false);
  };

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar
        userRole="admin"
        userName={profile?.full_name || ''}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Building2 className="h-6 w-6" /> Agency Management
              </h1>
              <p className="text-muted-foreground">Manage staffing agencies and track their providers</p>
            </div>
            <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />Add Agency</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editing ? 'Edit Agency' : 'Add New Agency'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Agency Name *</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Agency name" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Contact Name</Label>
                      <Input value={contactName} onChange={e => setContactName(e.target.value)} />
                    </div>
                    <div>
                      <Label>Contact Email</Label>
                      <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>Contact Phone</Label>
                    <Input value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setShowDialog(false); resetForm(); }}>Cancel</Button>
                  <Button onClick={handleSave} disabled={!name || saving}>
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editing ? 'Save Changes' : 'Add Agency'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Agencies ({agencies.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : agencies.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No agencies added yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agencies.map(agency => (
                      <TableRow key={agency.id}>
                        <TableCell className="font-medium">{agency.name}</TableCell>
                        <TableCell>{agency.contact_name || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{agency.contact_email || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={agency.is_active ? 'default' : 'secondary'}>
                            {agency.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(agency)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default AgencyManagementPage;
