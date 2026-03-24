import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { MvpBanner } from '@/components/MvpBanner';
import { useAuth } from '@/hooks/useAuth';
import { useHiringPipeline, STAGE_CONFIG, type HiringStage, type HiringCandidate } from '@/hooks/useHiringPipeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RefreshCw, Plus, Users, ArrowRight, Calendar, MapPin,
  Briefcase, ExternalLink, Archive, Clock, CheckCircle2,
  XCircle, Loader2, Filter
} from 'lucide-react';
import { format } from 'date-fns';

const ALL_STAGES: HiringStage[] = ['request_to_ds', 'candidates_provided', 'interview', 'hiring_decision', 'onboarding', 'started'];

const HiringPipelinePage = () => {
  const { profile, hasRole } = useAuth();
  const {
    candidates, loading, syncing, lastSyncAt, stageCounts,
    syncFromSlack, updateCandidate, archiveCandidate, addCandidate,
  } = useHiringPipeline();

  const [activeFilter, setActiveFilter] = useState<HiringStage | 'all'>('all');
  const [selectedCandidate, setSelectedCandidate] = useState<HiringCandidate | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newCandidate, setNewCandidate] = useState({ candidate_name: '', role: '', stage: 'request_to_ds' as HiringStage, notes: '', covered_states: '' });

  const isAdmin = hasRole('admin');
  const userName = profile?.full_name || profile?.email || 'User';
  const userEmail = profile?.email || '';
  const userRole = isAdmin ? 'admin' : 'pod_lead';

  const filteredCandidates = activeFilter === 'all'
    ? candidates
    : candidates.filter(c => c.stage === activeFilter);

  const handleAddCandidate = async () => {
    const states = newCandidate.covered_states.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    await addCandidate({
      candidate_name: newCandidate.candidate_name,
      role: newCandidate.role || null,
      stage: newCandidate.stage,
      notes: newCandidate.notes || null,
      covered_states: states,
    });
    setShowAddDialog(false);
    setNewCandidate({ candidate_name: '', role: '', stage: 'request_to_ds', notes: '', covered_states: '' });
  };

  const handleStageChange = async (id: string, newStage: HiringStage) => {
    await updateCandidate(id, { stage: newStage } as any);
  };

  const getDateForStage = (c: HiringCandidate): string | null => {
    switch (c.stage) {
      case 'request_to_ds': return c.ds_request_date;
      case 'candidates_provided': return c.candidates_provided_date;
      case 'interview': return c.interview_date;
      case 'hiring_decision': return c.hiring_decision_date;
      case 'onboarding': return c.onboarding_start_date;
      case 'started': return c.first_shift_date;
      default: return null;
    }
  };

  const getDecisionIcon = (decision: string | null) => {
    if (decision === 'hired') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (decision === 'rejected') return <XCircle className="h-4 w-4 text-red-500" />;
    return <Clock className="h-4 w-4 text-amber-500" />;
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
          <MvpBanner />

          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Hiring Pipeline</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Track candidates from DirectShifts request through onboarding.
                {lastSyncAt && (
                  <span className="ml-2 text-xs">
                    Last synced: {format(new Date(lastSyncAt), 'MMM d, h:mm a')}
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={syncFromSlack} disabled={syncing}>
                {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                {syncing ? 'Syncing…' : 'Refresh'}
              </Button>
              {isAdmin && (
                <Button size="sm" onClick={() => setShowAddDialog(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Add Candidate
                </Button>
              )}
            </div>
          </div>

          {/* Stage Summary Cards */}
          <div className="grid grid-cols-6 gap-3 mb-6">
            {ALL_STAGES.map(stage => {
              const config = STAGE_CONFIG[stage];
              const count = stageCounts[stage] || 0;
              const isActive = activeFilter === stage;
              return (
                <button
                  key={stage}
                  onClick={() => setActiveFilter(isActive ? 'all' : stage)}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    isActive ? 'ring-2 ring-primary border-primary' : 'hover:border-primary/50'
                  }`}
                >
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs text-muted-foreground mt-1">{config.label}</div>
                </button>
              );
            })}
          </div>

          {activeFilter !== 'all' && (
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Filtered: <strong>{STAGE_CONFIG[activeFilter].label}</strong>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setActiveFilter('all')} className="text-xs h-6 px-2">
                Clear
              </Button>
            </div>
          )}

          {/* Candidate Grid */}
          {loading && !candidates.length ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <Skeleton key={i} className="h-48 rounded-lg" />
              ))}
            </div>
          ) : filteredCandidates.length === 0 ? (
            <Card className="py-16">
              <CardContent className="text-center">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No candidates found</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {activeFilter !== 'all'
                    ? `No candidates in the "${STAGE_CONFIG[activeFilter].label}" stage.`
                    : 'Sync from Slack or add candidates manually to get started.'}
                </p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" size="sm" onClick={syncFromSlack} disabled={syncing}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Sync from Slack
                  </Button>
                  {isAdmin && (
                    <Button size="sm" onClick={() => setShowAddDialog(true)}>
                      <Plus className="h-4 w-4 mr-1" /> Add Manually
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredCandidates.map(candidate => {
                const stageConfig = STAGE_CONFIG[candidate.stage];
                const stageDate = getDateForStage(candidate);
                return (
                  <Card
                    key={candidate.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setSelectedCandidate(candidate)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base truncate">{candidate.candidate_name}</CardTitle>
                          {candidate.role && (
                            <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                              <Briefcase className="h-3.5 w-3.5" />
                              {candidate.role}
                            </div>
                          )}
                        </div>
                        {candidate.hiring_decision && getDecisionIcon(candidate.hiring_decision)}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Badge variant="outline" className={`${stageConfig.color} text-xs`}>
                        {stageConfig.label}
                      </Badge>

                      {candidate.covered_states && candidate.covered_states.length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {candidate.covered_states.join(', ')}
                        </div>
                      )}

                      {stageDate && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(stageDate), 'MMM d, yyyy')}
                        </div>
                      )}

                      {candidate.notes && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{candidate.notes}</p>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          via {candidate.source}
                        </span>
                        {candidate.slack_thread_url && (
                          <a
                            href={candidate.slack_thread_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-primary hover:underline flex items-center gap-0.5"
                          >
                            <ExternalLink className="h-3 w-3" /> Slack
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Candidate Detail Dialog */}
      <Dialog open={!!selectedCandidate} onOpenChange={() => setSelectedCandidate(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedCandidate?.candidate_name}</DialogTitle>
          </DialogHeader>
          {selectedCandidate && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Role</Label>
                  <p className="text-sm font-medium">{selectedCandidate.role || '—'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Source</Label>
                  <p className="text-sm font-medium capitalize">{selectedCandidate.source}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">States</Label>
                  <p className="text-sm font-medium">{selectedCandidate.covered_states?.join(', ') || '—'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Decision</Label>
                  <div className="flex items-center gap-1">
                    {selectedCandidate.hiring_decision ? getDecisionIcon(selectedCandidate.hiring_decision) : null}
                    <p className="text-sm font-medium capitalize">{selectedCandidate.hiring_decision || 'Pending'}</p>
                  </div>
                </div>
              </div>

              {/* Stage Selector */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Pipeline Stage</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_STAGES.map(stage => {
                    const config = STAGE_CONFIG[stage];
                    const isCurrent = selectedCandidate.stage === stage;
                    return (
                      <button
                        key={stage}
                        onClick={() => handleStageChange(selectedCandidate.id, stage)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                          isCurrent ? config.color + ' font-medium' : 'text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        {config.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {selectedCandidate.ds_request_date && (
                  <div><span className="text-xs text-muted-foreground">DS Request:</span> {format(new Date(selectedCandidate.ds_request_date), 'MMM d, yyyy')}</div>
                )}
                {selectedCandidate.candidates_provided_date && (
                  <div><span className="text-xs text-muted-foreground">Candidates:</span> {format(new Date(selectedCandidate.candidates_provided_date), 'MMM d, yyyy')}</div>
                )}
                {selectedCandidate.interview_date && (
                  <div><span className="text-xs text-muted-foreground">Interview:</span> {format(new Date(selectedCandidate.interview_date), 'MMM d, yyyy')}</div>
                )}
                {selectedCandidate.onboarding_start_date && (
                  <div><span className="text-xs text-muted-foreground">Onboarding:</span> {format(new Date(selectedCandidate.onboarding_start_date), 'MMM d, yyyy')}</div>
                )}
                {selectedCandidate.first_shift_date && (
                  <div><span className="text-xs text-muted-foreground">First Shift:</span> {format(new Date(selectedCandidate.first_shift_date), 'MMM d, yyyy')}</div>
                )}
              </div>

              {/* Notes */}
              {selectedCandidate.notes && (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="text-sm mt-1 bg-muted/50 rounded p-2">{selectedCandidate.notes}</p>
                </div>
              )}

              {/* Source Context */}
              {selectedCandidate.source_context && (selectedCandidate.source_context as any[]).length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Source Context</Label>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {(selectedCandidate.source_context as any[]).map((msg: any, i: number) => (
                      <div key={i} className="text-xs bg-muted/50 rounded p-2">
                        <span className="font-medium">#{msg.channel}</span>
                        <span className="text-muted-foreground ml-1">@{msg.user}</span>
                        <p className="mt-0.5 text-muted-foreground">{msg.text?.slice(0, 200)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                {selectedCandidate.slack_thread_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={selectedCandidate.slack_thread_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1" /> View in Slack
                    </a>
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={async () => {
                      await archiveCandidate(selectedCandidate.id);
                      setSelectedCandidate(null);
                    }}
                  >
                    <Archive className="h-4 w-4 mr-1" /> Archive
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Candidate Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Candidate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={newCandidate.candidate_name}
                onChange={e => setNewCandidate(p => ({ ...p, candidate_name: e.target.value }))}
                placeholder="Full name"
              />
            </div>
            <div>
              <Label>Role</Label>
              <Input
                value={newCandidate.role}
                onChange={e => setNewCandidate(p => ({ ...p, role: e.target.value }))}
                placeholder="e.g. PMHNP, FNP, PA"
              />
            </div>
            <div>
              <Label>Stage</Label>
              <Select
                value={newCandidate.stage}
                onValueChange={v => setNewCandidate(p => ({ ...p, stage: v as HiringStage }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_STAGES.map(s => (
                    <SelectItem key={s} value={s}>{STAGE_CONFIG[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Covered States (comma-separated)</Label>
              <Input
                value={newCandidate.covered_states}
                onChange={e => setNewCandidate(p => ({ ...p, covered_states: e.target.value }))}
                placeholder="TX, FL, CA"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={newCandidate.notes}
                onChange={e => setNewCandidate(p => ({ ...p, notes: e.target.value }))}
                placeholder="Any context..."
              />
            </div>
            <Button onClick={handleAddCandidate} disabled={!newCandidate.candidate_name} className="w-full">
              Add Candidate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HiringPipelinePage;
