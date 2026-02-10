import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Building2, Plus, Loader2, ChevronRight } from 'lucide-react';

const AgencyManagementPage = () => {
  const { profile } = useAuth();
  const { agencies, loading, createAgency } = useAgencies();
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const resetForm = () => { setName(''); setNotes(''); };

  const handleSave = async () => {
    if (!name) return;
    setSaving(true);
    try {
      const result = await createAgency({ name, notes: notes || null });
      setShowDialog(false);
      resetForm();
      if (result) navigate(`/admin/agencies/${(result as Agency).id}`);
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
      <main className="flex-1 p-6 overflow-auto ml-64">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Building2 className="h-6 w-6" /> Agency Management
              </h1>
              <p className="text-muted-foreground">Manage external staffing agencies and their provider relationships</p>
            </div>
            <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />Add Agency</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Agency</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Agency Name *</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Agency name" />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Relationship details, context..." />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setShowDialog(false); resetForm(); }}>Cancel</Button>
                  <Button onClick={handleSave} disabled={!name || saving}>
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Add Agency
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
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agencies.map(agency => (
                      <TableRow
                        key={agency.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/admin/agencies/${agency.id}`)}
                      >
                        <TableCell className="font-medium">{agency.name}</TableCell>
                        <TableCell>
                          <Badge variant={agency.is_active ? 'default' : 'secondary'}>
                            {agency.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[300px] truncate">
                          {agency.notes || '—'}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
