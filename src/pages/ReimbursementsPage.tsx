import { useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useReimbursements, ReimbursementRequest } from '@/hooks/useReimbursements';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DollarSign, Plus, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { allUSStates } from '@/data/allStates';

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rejected: 'bg-destructive/10 text-destructive',
  processed: 'bg-primary/10 text-primary',
};

const ReimbursementsPage = () => {
  const { profile, roles } = useAuth();
  const isAdmin = roles.includes('admin');
  const { requests, loading, createRequest, approveRequest, rejectRequest, markProcessed, refetch } = useReimbursements(
    isAdmin ? {} : { providerId: profile?.id }
  );

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [reviewDialog, setReviewDialog] = useState<ReimbursementRequest | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // New request form state
  const [newState, setNewState] = useState('');
  const [newFeeAmount, setNewFeeAmount] = useState('');
  const [newHours, setNewHours] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newReceiptUrl, setNewReceiptUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'all') return requests;
    return requests.filter(r => r.status === statusFilter);
  }, [requests, statusFilter]);

  const totals = useMemo(() => {
    const pending = requests.filter(r => ['submitted', 'approved'].includes(r.status));
    const processed = requests.filter(r => r.status === 'processed');
    return {
      pendingAmount: pending.reduce((sum, r) => sum + (r.total_reimbursement || 0), 0),
      processedAmount: processed.reduce((sum, r) => sum + (r.total_reimbursement || 0), 0),
      pendingCount: pending.length,
    };
  }, [requests]);

  const handleSubmitNew = async () => {
    if (!profile || !newState) return;
    setSubmitting(true);
    try {
      await createRequest({
        provider_id: profile.id,
        provider_name: profile.full_name || profile.email,
        state_abbreviation: newState,
        application_fee_amount: newFeeAmount ? parseFloat(newFeeAmount) : null,
        admin_hours_spent: newHours ? parseFloat(newHours) : null,
        application_fee_receipt_url: newReceiptUrl || null,
        description: newDescription || null,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      });
      setShowNewDialog(false);
      setNewState(''); setNewFeeAmount(''); setNewHours(''); setNewDescription(''); setNewReceiptUrl('');
    } catch { /* handled in hook */ }
    setSubmitting(false);
  };

  const handleApprove = async () => {
    if (!reviewDialog || !profile) return;
    await approveRequest(reviewDialog.id, profile.id, reviewNotes);
    setReviewDialog(null);
    setReviewNotes('');
  };

  const handleReject = async () => {
    if (!reviewDialog || !profile || !reviewNotes) return;
    await rejectRequest(reviewDialog.id, profile.id, reviewNotes);
    setReviewDialog(null);
    setReviewNotes('');
  };

  const handleProcess = async (id: string) => {
    if (!profile) return;
    await markProcessed(id, profile.id);
  };

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar
        userRole={isAdmin ? 'admin' : 'provider'}
        userName={profile?.full_name || ''}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Reimbursements</h1>
              <p className="text-muted-foreground">
                {isAdmin ? 'Review and process provider reimbursement requests' : 'Track license application costs and admin time'}
              </p>
            </div>
            {!isAdmin && (
              <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
                <DialogTrigger asChild>
                  <Button><Plus className="h-4 w-4 mr-2" />New Request</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Submit Reimbursement Request</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>State</Label>
                      <Select value={newState} onValueChange={setNewState}>
                        <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                        <SelectContent>
                          {allUSStates.map(s => (
                            <SelectItem key={s.abbreviation} value={s.abbreviation}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Application Fee ($)</Label>
                        <Input type="number" step="0.01" placeholder="0.00" value={newFeeAmount} onChange={e => setNewFeeAmount(e.target.value)} />
                      </div>
                      <div>
                        <Label>Admin Hours Spent</Label>
                        <Input type="number" step="0.25" placeholder="0" value={newHours} onChange={e => setNewHours(e.target.value)} />
                        <p className="text-xs text-muted-foreground mt-1">Paid at $50/hr</p>
                      </div>
                    </div>
                    <div>
                      <Label>Receipt / Evidence URL</Label>
                      <Input placeholder="https://..." value={newReceiptUrl} onChange={e => setNewReceiptUrl(e.target.value)} />
                    </div>
                    <div>
                      <Label>Description</Label>
                      <Textarea placeholder="Brief description of the license application..." value={newDescription} onChange={e => setNewDescription(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancel</Button>
                    <Button onClick={handleSubmitNew} disabled={!newState || submitting}>
                      {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Submit
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pending</p>
                    <p className="text-2xl font-bold">${totals.pendingAmount.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{totals.pendingCount} requests</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-accent rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Processed</p>
                    <p className="text-2xl font-bold">${totals.processedAmount.toFixed(2)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <DollarSign className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Requests</p>
                    <p className="text-2xl font-bold">{requests.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter + Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Requests</CardTitle>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="processed">Processed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredRequests.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No reimbursement requests found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {isAdmin && <TableHead>Provider</TableHead>}
                      <TableHead>State</TableHead>
                      <TableHead>App Fee</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Admin Pay</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                      {isAdmin && <TableHead>Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRequests.map(req => (
                      <TableRow key={req.id}>
                        {isAdmin && <TableCell className="font-medium">{req.provider_name}</TableCell>}
                        <TableCell>{req.state_abbreviation}</TableCell>
                        <TableCell>${(req.application_fee_amount || 0).toFixed(2)}</TableCell>
                        <TableCell>{req.admin_hours_spent || 0}h</TableCell>
                        <TableCell>${(req.admin_time_total || 0).toFixed(2)}</TableCell>
                        <TableCell className="font-semibold">${(req.total_reimbursement || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColors[req.status] || ''}>
                            {req.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {req.submitted_at ? format(new Date(req.submitted_at), 'MMM d, yyyy') : '—'}
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            {req.status === 'submitted' && (
                              <Button size="sm" variant="outline" onClick={() => { setReviewDialog(req); setReviewNotes(''); }}>
                                Review
                              </Button>
                            )}
                            {req.status === 'approved' && (
                              <Button size="sm" variant="outline" onClick={() => handleProcess(req.id)}>
                                Mark Processed
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Review Dialog */}
        <Dialog open={!!reviewDialog} onOpenChange={(open) => { if (!open) setReviewDialog(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Review Reimbursement</DialogTitle>
            </DialogHeader>
            {reviewDialog && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Provider:</span> {reviewDialog.provider_name}</div>
                  <div><span className="text-muted-foreground">State:</span> {reviewDialog.state_abbreviation}</div>
                  <div><span className="text-muted-foreground">App Fee:</span> ${(reviewDialog.application_fee_amount || 0).toFixed(2)}</div>
                  <div><span className="text-muted-foreground">Admin Hours:</span> {reviewDialog.admin_hours_spent || 0}h @ ${reviewDialog.hourly_rate}/hr</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Total:</span> <span className="font-bold text-lg">${(reviewDialog.total_reimbursement || 0).toFixed(2)}</span></div>
                </div>
                {reviewDialog.description && (
                  <div>
                    <Label className="text-muted-foreground">Description</Label>
                    <p className="text-sm">{reviewDialog.description}</p>
                  </div>
                )}
                {reviewDialog.application_fee_receipt_url && (
                  <div>
                    <Label className="text-muted-foreground">Receipt</Label>
                    <a href={reviewDialog.application_fee_receipt_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                      View Receipt
                    </a>
                  </div>
                )}
                <div>
                  <Label>Review Notes</Label>
                  <Textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Optional notes (required for rejection)" />
                </div>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="destructive" onClick={handleReject} disabled={!reviewNotes}>
                <XCircle className="h-4 w-4 mr-2" />Reject
              </Button>
              <Button onClick={handleApprove}>
                <CheckCircle2 className="h-4 w-4 mr-2" />Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default ReimbursementsPage;
