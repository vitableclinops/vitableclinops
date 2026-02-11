import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useLicensureSteps, type LicensureApplication, type LicensureStep } from '@/hooks/useLicensureApplications';
import { useStateCompliance } from '@/hooks/useStateCompliance';
import { supabase } from '@/integrations/supabase/client';
import { getCollabRequirementType } from '@/constants/stateRestrictions';
import {
  ArrowLeft, CheckCircle2, Circle, Clock, Upload, ExternalLink,
  AlertTriangle, Shield, FileText, ChevronDown, ChevronUp, Loader2,
  DollarSign, Info, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export default function LicensureApplicationPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const { profile, roles } = useAuth();
  const [application, setApplication] = useState<LicensureApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const { steps, loading: stepsLoading, refetch: refetchSteps } = useLicensureSteps(applicationId);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [updatingStep, setUpdatingStep] = useState<string | null>(null);

  const userRole = roles.includes('admin') ? 'admin' : roles.includes('physician') ? 'physician' : 'provider';
  const isAdmin = roles.includes('admin');
  const isOwner = application?.provider_id === profile?.id;
  const canEdit = isAdmin || isOwner;

  const stateAbbr = application?.state_abbreviation;
  const { data: stateCompliance } = useStateCompliance(stateAbbr || undefined);
  const caType = stateAbbr ? getCollabRequirementType(stateAbbr) : null;

  useEffect(() => {
    if (!applicationId) return;
    const fetchApp = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('licensure_applications')
        .select('*')
        .eq('id', applicationId)
        .single();
      setApplication(data as any);
      setLoading(false);
    };
    fetchApp();
  }, [applicationId]);

  const completedSteps = steps.filter(s => s.status === 'approved' || s.status === 'submitted');
  const requiredSteps = steps.filter(s => s.is_required);
  const progressPercent = requiredSteps.length > 0
    ? Math.round((completedSteps.filter(s => requiredSteps.some(r => r.id === s.id)).length / requiredSteps.length) * 100)
    : 0;

  const updateStepStatus = async (stepId: string, status: LicensureStep['status']) => {
    setUpdatingStep(stepId);
    const updates: any = { status };
    if (status === 'in_progress' && !steps.find(s => s.id === stepId)?.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (status === 'submitted' || status === 'approved') {
      updates.completed_at = new Date().toISOString();
    }

    await supabase.from('licensure_application_steps').update(updates).eq('id', stepId);

    // Update application status based on step progress
    const updatedSteps = steps.map(s => s.id === stepId ? { ...s, status } : s);
    const allRequired = updatedSteps.filter(s => s.is_required);
    const allDone = allRequired.every(s => s.status === 'approved' || s.status === 'submitted');
    const anyStarted = updatedSteps.some(s => s.status !== 'not_started');

    let appStatus = application?.status;
    if (allDone) appStatus = 'submitted';
    else if (anyStarted) appStatus = 'in_progress';

    if (appStatus !== application?.status) {
      const appUpdates: any = { status: appStatus };
      if (appStatus === 'in_progress' && !application?.started_at) appUpdates.started_at = new Date().toISOString();
      if (appStatus === 'submitted') appUpdates.submitted_at = new Date().toISOString();
      await supabase.from('licensure_applications').update(appUpdates).eq('id', applicationId);
      setApplication(prev => prev ? { ...prev, ...appUpdates, status: appStatus! } : prev);
    }

    refetchSteps();
    setUpdatingStep(null);
  };

  const updateStepField = async (stepId: string, field: string, value: any) => {
    await supabase.from('licensure_application_steps').update({ [field]: value }).eq('id', stepId);
    refetchSteps();
  };

  const statusConfig: Record<string, { icon: typeof Circle; color: string; label: string }> = {
    not_started: { icon: Circle, color: 'text-muted-foreground', label: 'Not Started' },
    in_progress: { icon: Clock, color: 'text-warning', label: 'In Progress' },
    submitted: { icon: CheckCircle2, color: 'text-primary', label: 'Submitted' },
    approved: { icon: CheckCircle2, color: 'text-success', label: 'Approved' },
    skipped: { icon: Circle, color: 'text-muted-foreground/50', label: 'Skipped' },
  };

  if (loading || !application) {
    return (
      <div className="min-h-screen bg-background">
        <AppSidebar userRole={userRole as any} userName={profile?.full_name || ''} userEmail={profile?.email || ''} userAvatarUrl={profile?.avatar_url || undefined} />
        <main className="ml-16 lg:ml-64 p-8">
          <div className="flex items-center justify-center min-h-[50vh]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </main>
      </div>
    );
  }

  const breadcrumbs = isAdmin
    ? [
        { label: 'States', href: '/admin/states' },
        { label: application.state_name, href: `/states/${application.state_abbreviation}` },
        { label: `${application.designation_label} — ${application.provider_name}` },
      ]
    : [
        { label: 'Dashboard', href: '/provider' },
        { label: `${application.designation_label} — ${application.state_name}` },
      ];

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar userRole={userRole as any} userName={profile?.full_name || ''} userEmail={profile?.email || ''} userAvatarUrl={profile?.avatar_url || undefined} />

      <main className="ml-16 lg:ml-64 transition-all duration-300">
        <div className="p-4 md:p-6 lg:p-8 max-w-4xl">
          <Breadcrumbs items={breadcrumbs} className="mb-4" />

          <Link to={isAdmin ? `/states/${application.state_abbreviation}` : '/provider'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>

          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {application.designation_label}
              </h1>
              <p className="text-muted-foreground mt-1">
                {application.state_name} • {application.provider_name}
              </p>
            </div>
            <Badge
              variant={application.status === 'approved' ? 'default' : 'secondary'}
              className={cn(
                application.status === 'approved' && 'bg-success/10 text-success',
                application.status === 'submitted' && 'bg-primary/10 text-primary',
                application.status === 'in_progress' && 'bg-warning/10 text-warning',
                application.status === 'blocked' && 'bg-destructive/10 text-destructive',
              )}
            >
              {application.status.replace(/_/g, ' ')}
            </Badge>
          </div>

          {/* Progress bar */}
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Progress</p>
                <p className="text-sm text-muted-foreground">{completedSteps.length} of {requiredSteps.length} required steps</p>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Steps */}
            <div className="lg:col-span-2 space-y-3">
              <h2 className="text-lg font-semibold mb-2">Application Steps</h2>
              {steps.map((step, idx) => {
                const config = statusConfig[step.status];
                const Icon = config.icon;
                const isExpanded = expandedStep === step.id;
                const canProceed = idx === 0 || steps.slice(0, idx).filter(s => s.is_required).every(s => s.status === 'submitted' || s.status === 'approved');

                return (
                  <Card key={step.id} className={cn(
                    'transition-colors',
                    !canProceed && step.is_required && 'opacity-60',
                  )}>
                    <div
                      className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                    >
                      <div className="mt-0.5">
                        <Icon className={cn('h-5 w-5', config.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{step.title}</p>
                          {!step.is_required && <Badge variant="outline" className="text-xs">Optional</Badge>}
                        </div>
                        {step.description && !isExpanded && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{step.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">{config.label}</Badge>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t space-y-4">
                        {step.description && (
                          <p className="text-sm text-muted-foreground pt-3">{step.description}</p>
                        )}

                        {/* Status actions */}
                        {canEdit && canProceed && (
                          <div className="flex flex-wrap gap-2 pt-2">
                            {step.status === 'not_started' && (
                              <Button size="sm" onClick={() => updateStepStatus(step.id, 'in_progress')} disabled={updatingStep === step.id}>
                                {updatingStep === step.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                                Start
                              </Button>
                            )}
                            {step.status === 'in_progress' && (
                              <Button size="sm" onClick={() => updateStepStatus(step.id, 'submitted')} disabled={updatingStep === step.id}>
                                {updatingStep === step.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                                Mark Submitted
                              </Button>
                            )}
                            {isAdmin && step.status === 'submitted' && (
                              <Button size="sm" variant="default" onClick={() => updateStepStatus(step.id, 'approved')} disabled={updatingStep === step.id}>
                                Approve
                              </Button>
                            )}
                            {step.status !== 'not_started' && (
                              <Button size="sm" variant="outline" onClick={() => updateStepStatus(step.id, 'not_started')} disabled={updatingStep === step.id}>
                                Reset
                              </Button>
                            )}
                            {!step.is_required && step.status === 'not_started' && (
                              <Button size="sm" variant="ghost" onClick={() => updateStepStatus(step.id, 'skipped')}>
                                Skip
                              </Button>
                            )}
                          </div>
                        )}

                        <Separator />

                        {/* Submitted date */}
                        <div className="space-y-1">
                          <Label className="text-xs">Date Submitted</Label>
                          <Input
                            type="date"
                            value={step.submitted_date || ''}
                            onChange={(e) => updateStepField(step.id, 'submitted_date', e.target.value || null)}
                            disabled={!canEdit}
                            className="max-w-[200px]"
                          />
                        </div>

                        {/* File upload area */}
                        <div className="space-y-1">
                          <Label className="text-xs">Upload Document / Receipt</Label>
                          {step.uploaded_file_name ? (
                            <div className="flex items-center gap-2 text-sm">
                              <FileText className="h-4 w-4 text-primary" />
                              <span>{step.uploaded_file_name}</span>
                              {canEdit && (
                                <Button size="sm" variant="ghost" onClick={() => updateStepField(step.id, 'uploaded_file_name', null)}>
                                  Remove
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="outline" disabled={!canEdit}>
                                <Upload className="h-3 w-3 mr-1" />
                                Upload
                              </Button>
                              <span className="text-xs text-muted-foreground">Confirmation screenshots, receipts, etc.</span>
                            </div>
                          )}
                        </div>

                        {/* Fee / Reimbursement */}
                        {step.fee_amount !== null && step.fee_amount !== undefined && step.fee_amount > 0 && (
                          <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
                            <div className="flex items-center gap-2">
                              <DollarSign className="h-4 w-4 text-muted-foreground" />
                              <p className="text-sm font-medium">Fee: ${step.fee_amount}</p>
                              <Badge variant="secondary" className="text-xs">
                                {step.reimbursement_status === 'none' ? 'Not submitted' : step.reimbursement_status}
                              </Badge>
                            </div>
                            {canEdit && step.reimbursement_status === 'none' && step.fee_receipt_url && (
                              <Button size="sm" variant="outline" onClick={() => updateStepField(step.id, 'reimbursement_status', 'ready')}>
                                Flag for Reimbursement
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Notes */}
                        <div className="space-y-1">
                          <Label className="text-xs">Notes</Label>
                          <Textarea
                            value={step.provider_notes || ''}
                            onChange={(e) => updateStepField(step.id, 'provider_notes', e.target.value || null)}
                            placeholder="Add any notes about this step…"
                            rows={2}
                            disabled={!canEdit}
                          />
                        </div>

                        {/* Timestamps */}
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          {step.started_at && <span>Started: {format(new Date(step.started_at), 'MMM d, yyyy')}</span>}
                          {step.completed_at && <span>Completed: {format(new Date(step.completed_at), 'MMM d, yyyy')}</span>}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* State info card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">State Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {stateCompliance?.knowledge_base_url && (
                    <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                      <a href={stateCompliance.knowledge_base_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        State Nursing Board
                      </a>
                    </Button>
                  )}
                  {stateCompliance?.steps_to_confirm_eligibility && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Eligibility Steps</p>
                      <p className="text-xs whitespace-pre-wrap bg-muted/50 p-2 rounded">{stateCompliance.steps_to_confirm_eligibility}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* CA awareness */}
              {caType && caType !== 'never' && (
                <Alert>
                  <Users className="h-4 w-4" />
                  <AlertTitle className="text-sm">Collaborative Agreement</AlertTitle>
                  <AlertDescription className="text-xs">
                    {caType === 'always'
                      ? `A collaborative agreement is always required in ${application.state_name}. After your license is approved, one will need to be established.`
                      : `A collaborative agreement may be conditionally required in ${application.state_name} depending on your practice status.`}
                    {stateCompliance?.ca_meeting_cadence && (
                      <span className="block mt-1">Meeting cadence: {stateCompliance.ca_meeting_cadence}</span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {caType === 'never' && (
                <div className="rounded-lg border p-3 bg-success/5">
                  <div className="flex items-center gap-2 text-sm">
                    <Shield className="h-4 w-4 text-success" />
                    <span className="font-medium text-success">Full Practice Authority</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">No collaborative agreement required in {application.state_name}.</p>
                </div>
              )}

              {/* Application meta */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Initiated</span>
                    <span>{format(new Date(application.initiated_at), 'MMM d, yyyy')}</span>
                  </div>
                  {application.started_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Started</span>
                      <span>{format(new Date(application.started_at), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                  {application.submitted_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Submitted</span>
                      <span>{format(new Date(application.submitted_at), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                  {application.approved_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Approved</span>
                      <span>{format(new Date(application.approved_at), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Admin notes */}
              {isAdmin && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Admin Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={application.admin_notes || ''}
                      onChange={async (e) => {
                        const val = e.target.value;
                        setApplication(prev => prev ? { ...prev, admin_notes: val } : prev);
                        await supabase.from('licensure_applications').update({ admin_notes: val }).eq('id', application.id);
                      }}
                      placeholder="Internal notes…"
                      rows={3}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={cn('text-sm font-medium', className)}>{children}</label>;
}
