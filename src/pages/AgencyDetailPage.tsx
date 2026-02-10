import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAgencies, Agency } from '@/hooks/useAgencies';
import { useAgencyDetail, AgencyContact, AgencyDocument } from '@/hooks/useAgencyDetail';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  Building2, ArrowLeft, Plus, Edit, Trash2, Loader2, Users, FileText,
  Phone, Mail, Download, Upload, UserCircle, AlertTriangle,
} from 'lucide-react';

const AgencyDetailPage = () => {
  const { agencyId } = useParams<{ agencyId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { agencies, updateAgency } = useAgencies();
  const {
    contacts, documents, providers, loading,
    addContact, updateContact, deleteContact,
    uploadDocument, deleteDocument, getDocumentUrl, refetch,
  } = useAgencyDetail(agencyId);

  const agency = agencies.find(a => a.id === agencyId);

  // Contact dialog
  const [contactDialog, setContactDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<AgencyContact | null>(null);
  const [cName, setCName] = useState('');
  const [cRole, setCRole] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cMethod, setCMethod] = useState('email');
  const [cNotes, setCNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Document dialog
  const [docDialog, setDocDialog] = useState(false);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('contract');
  const [docEffective, setDocEffective] = useState('');
  const [docExpiration, setDocExpiration] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Agency edit
  const [editDialog, setEditDialog] = useState(false);
  const [agencyName, setAgencyName] = useState('');
  const [agencyNotes, setAgencyNotes] = useState('');

  const resetContactForm = () => {
    setCName(''); setCRole(''); setCEmail(''); setCPhone(''); setCMethod('email'); setCNotes('');
    setEditingContact(null);
  };

  const openEditContact = (c: AgencyContact) => {
    setEditingContact(c);
    setCName(c.contact_name);
    setCRole(c.role_title || '');
    setCEmail(c.email || '');
    setCPhone(c.phone || '');
    setCMethod(c.preferred_contact_method || 'email');
    setCNotes(c.notes || '');
    setContactDialog(true);
  };

  const handleSaveContact = async () => {
    if (!cName) return;
    setSaving(true);
    try {
      const payload = {
        contact_name: cName,
        role_title: cRole || null,
        email: cEmail || null,
        phone: cPhone || null,
        preferred_contact_method: cMethod,
        notes: cNotes || null,
      };
      if (editingContact) {
        await updateContact(editingContact.id, payload);
      } else {
        await addContact(payload);
      }
      setContactDialog(false);
      resetContactForm();
    } catch { /* handled */ }
    setSaving(false);
  };

  const handleUploadDoc = async () => {
    if (!docFile || !docName) return;
    setSaving(true);
    try {
      await uploadDocument(docFile, {
        document_name: docName,
        document_type: docType,
        effective_date: docEffective || undefined,
        expiration_date: docExpiration || undefined,
        notes: docNotes || undefined,
        uploaded_by: profile?.id,
        uploaded_by_name: profile?.full_name || undefined,
      });
      setDocDialog(false);
      setDocName(''); setDocType('contract'); setDocEffective(''); setDocExpiration(''); setDocNotes(''); setDocFile(null);
    } catch { /* handled */ }
    setSaving(false);
  };

  const handleDownload = async (doc: AgencyDocument) => {
    const url = await getDocumentUrl(doc.storage_path);
    if (url) window.open(url, '_blank');
  };

  const openEditAgency = () => {
    if (!agency) return;
    setAgencyName(agency.name);
    setAgencyNotes(agency.notes || '');
    setEditDialog(true);
  };

  const handleSaveAgency = async () => {
    if (!agency || !agencyName) return;
    setSaving(true);
    try {
      await updateAgency(agency.id, { name: agencyName, notes: agencyNotes || null });
      setEditDialog(false);
    } catch { /* handled */ }
    setSaving(false);
  };

  if (!agency && !loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <AppSidebar userRole="admin" userName={profile?.full_name || ''} userEmail={profile?.email || ''} />
        <main className="flex-1 p-6 ml-64">
          <p className="text-muted-foreground">Agency not found.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar userRole="admin" userName={profile?.full_name || ''} userEmail={profile?.email || ''} userAvatarUrl={profile?.avatar_url || undefined} />
      <main className="flex-1 p-6 overflow-auto ml-64">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin/agencies')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Building2 className="h-6 w-6" />
                {agency?.name || 'Loading...'}
              </h1>
              {agency && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={agency.is_active ? 'default' : 'secondary'}>
                    {agency.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">External Agency</span>
                </div>
              )}
            </div>
            <Button variant="outline" onClick={openEditAgency}>
              <Edit className="h-4 w-4 mr-2" />Edit Agency
            </Button>
          </div>

          {/* Agency notes */}
          {agency?.notes && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{agency.notes}</p>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="contacts">
            <TabsList>
              <TabsTrigger value="contacts" className="gap-1.5"><UserCircle className="h-4 w-4" />Contacts ({contacts.length})</TabsTrigger>
              <TabsTrigger value="providers" className="gap-1.5"><Users className="h-4 w-4" />Linked Providers ({providers.length})</TabsTrigger>
              <TabsTrigger value="documents" className="gap-1.5"><FileText className="h-4 w-4" />Documents ({documents.length})</TabsTrigger>
            </TabsList>

            {/* CONTACTS TAB */}
            <TabsContent value="contacts">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Contacts</CardTitle>
                    <CardDescription>Agency contacts and relationship managers</CardDescription>
                  </div>
                  <Button size="sm" onClick={() => { resetContactForm(); setContactDialog(true); }}>
                    <Plus className="h-4 w-4 mr-2" />Add Contact
                  </Button>
                </CardHeader>
                <CardContent>
                  {contacts.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No contacts added yet.</p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {contacts.map(c => (
                        <Card key={c.id} className="border">
                          <CardContent className="pt-4 space-y-2">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="font-medium">{c.contact_name}</p>
                                {c.role_title && <p className="text-sm text-muted-foreground">{c.role_title}</p>}
                              </div>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" onClick={() => openEditContact(c)}><Edit className="h-3.5 w-3.5" /></Button>
                                <Button size="icon" variant="ghost" onClick={() => deleteContact(c.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                              </div>
                            </div>
                            {c.email && <div className="flex items-center gap-2 text-sm"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{c.email}</div>}
                            {c.phone && <div className="flex items-center gap-2 text-sm"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{c.phone}</div>}
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">Preferred: {c.preferred_contact_method}</Badge>
                            </div>
                            {c.notes && <p className="text-xs text-muted-foreground italic">{c.notes}</p>}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* PROVIDERS TAB */}
            <TabsContent value="providers">
              <Card>
                <CardHeader>
                  <CardTitle>Linked Providers</CardTitle>
                  <CardDescription>Providers supplied by this agency. Compliance is shown for visibility only — licensure and agreements are externally managed.</CardDescription>
                </CardHeader>
                <CardContent>
                  {providers.length === 0 ? (
                    <div className="text-center py-8 space-y-2">
                      <p className="text-muted-foreground">No providers linked to this agency.</p>
                      <p className="text-xs text-muted-foreground">Set a provider's employment type to "Agency-Supplied" and link this agency from their profile.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Provider</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>NPI</TableHead>
                          <TableHead>Licensed States</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Compliance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {providers.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium">{p.full_name || 'Unknown'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="gap-1 bg-orange-500/10 text-orange-600 border-orange-500/30">
                                <Building2 className="h-3 w-3" />Agency-Supplied
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{p.npi_number || '—'}</TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm">{p.actively_licensed_states || '—'}</TableCell>
                            <TableCell>
                              <Badge variant={p.employment_status === 'active' ? 'default' : 'secondary'}>
                                {p.employment_status || 'Unknown'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Externally Managed</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* DOCUMENTS TAB */}
            <TabsContent value="documents">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Contracts & Documents</CardTitle>
                    <CardDescription>MSAs, amendments, and agreements linked to this agency</CardDescription>
                  </div>
                  <Button size="sm" onClick={() => setDocDialog(true)}>
                    <Upload className="h-4 w-4 mr-2" />Upload Document
                  </Button>
                </CardHeader>
                <CardContent>
                  {documents.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No documents uploaded.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Effective</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>Uploaded By</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {documents.map(doc => (
                          <TableRow key={doc.id}>
                            <TableCell className="font-medium">{doc.document_name}</TableCell>
                            <TableCell><Badge variant="outline">{doc.document_type}</Badge></TableCell>
                            <TableCell className="text-sm">{doc.effective_date || '—'}</TableCell>
                            <TableCell className="text-sm">
                              {doc.expiration_date ? (
                                <span className={new Date(doc.expiration_date) < new Date() ? 'text-destructive font-medium' : ''}>
                                  {doc.expiration_date}
                                </span>
                              ) : '—'}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{doc.uploaded_by_name || '—'}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" onClick={() => handleDownload(doc)}><Download className="h-4 w-4" /></Button>
                                <Button size="icon" variant="ghost" onClick={() => deleteDocument(doc)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Contact Dialog */}
      <Dialog open={contactDialog} onOpenChange={(open) => { setContactDialog(open); if (!open) resetContactForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingContact ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Contact Name *</Label>
              <Input value={cName} onChange={e => setCName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <Label>Role / Title</Label>
              <Input value={cRole} onChange={e => setCRole(e.target.value)} placeholder="e.g. Account Manager" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Email</Label>
                <Input type="email" value={cEmail} onChange={e => setCEmail(e.target.value)} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={cPhone} onChange={e => setCPhone(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Preferred Contact Method</Label>
              <Select value={cMethod} onValueChange={setCMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="slack">Slack</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={cNotes} onChange={e => setCNotes(e.target.value)} placeholder="e.g. Best for urgent issues" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setContactDialog(false); resetContactForm(); }}>Cancel</Button>
            <Button onClick={handleSaveContact} disabled={!cName || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingContact ? 'Save' : 'Add Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Upload Dialog */}
      <Dialog open={docDialog} onOpenChange={setDocDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Document Name *</Label>
              <Input value={docName} onChange={e => setDocName(e.target.value)} placeholder="e.g. MSA 2025" />
            </div>
            <div>
              <Label>Document Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="msa">MSA</SelectItem>
                  <SelectItem value="amendment">Amendment</SelectItem>
                  <SelectItem value="agreement">Agreement</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Effective Date</Label>
                <Input type="date" value={docEffective} onChange={e => setDocEffective(e.target.value)} />
              </div>
              <div>
                <Label>Expiration Date</Label>
                <Input type="date" value={docExpiration} onChange={e => setDocExpiration(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>File *</Label>
              <Input
                ref={fileInputRef}
                type="file"
                onChange={e => setDocFile(e.target.files?.[0] || null)}
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={docNotes} onChange={e => setDocNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocDialog(false)}>Cancel</Button>
            <Button onClick={handleUploadDoc} disabled={!docFile || !docName || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Agency Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Agency</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Agency Name *</Label>
              <Input value={agencyName} onChange={e => setAgencyName(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={agencyNotes} onChange={e => setAgencyNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveAgency} disabled={!agencyName || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgencyDetailPage;
