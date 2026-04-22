import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertTriangle, CheckCircle2, Clock, XCircle, RefreshCw,
  TrendingUp, TrendingDown, Users, DollarSign, Shield, Zap, Download,
  Info, ChevronDown,
} from 'lucide-react';
import { downloadCSV } from '@/lib/utils';

// ── Constants ─────────────────────────────────────────────────────────────────

// DirectShifts hourly rates by credential
const DS_RATES: Record<string, number> = {
  NP: 125, APRN: 125, APN: 125,
  LPC: 105, LCSW: 105, MFT: 105,
  MD: 175, DO: 175,
};

// Equivalent W2 employee fully-loaded rates (salary ÷ 2080 + ~30% benefits burden)
const EMP_RATES: Record<string, number> = {
  NP: 88, APRN: 88, APN: 88,
  LPC: 72, LCSW: 72, MFT: 72,
  MD: 125, DO: 125,
};

// Interim clinical admin bridge rate
const ADMIN_BRIDGE_RATE = 45; // $/hr

// Required compliance docs by provider credential
type DocType =
  | 'state_license' | 'malpractice' | 'dea' | 'caqh' | 'cv'
  | 'collab_agreement' | 'board_certification' | 'background_check'
  | 'prescriptive_authority' | 'counseling_license';

const NP_AUTHORITY: Record<string, 'full' | 'reduced' | 'restricted'> = {
  AK:'full', AZ:'full', CO:'full', CT:'full', DC:'full', DE:'full',
  HI:'full', IA:'full', ID:'full', KY:'full', ME:'full', MD:'full',
  MN:'full', MT:'full', ND:'full', NH:'full', NM:'full', NV:'full',
  OR:'full', RI:'full', SD:'full', VT:'full', WA:'full', WY:'full',
  WI:'full', NE:'full',
  AL:'reduced', AR:'reduced', IL:'reduced', IN:'reduced', KS:'reduced',
  LA:'reduced', MA:'reduced', MI:'reduced', MO:'reduced', MS:'reduced',
  NJ:'reduced', NY:'reduced', OH:'reduced', OK:'reduced', SC:'reduced',
  TN:'reduced', UT:'reduced', WV:'reduced',
  CA:'restricted', FL:'restricted', GA:'restricted', NC:'restricted',
  PA:'restricted', TX:'restricted', VA:'restricted',
};

function generateChecklist(credentials: string | null, state: string): DocType[] {
  const cred = (credentials ?? '').toUpperCase().split(/[/,\s]/)[0].trim();
  const docs: DocType[] = ['state_license', 'malpractice', 'cv', 'caqh', 'background_check'];

  if (cred === 'NP' || cred === 'APRN' || cred === 'APN') {
    docs.push('dea', 'prescriptive_authority');
    const auth = NP_AUTHORITY[state];
    if (auth === 'restricted' || auth === 'reduced') docs.push('collab_agreement');
  } else if (cred === 'MD' || cred === 'DO') {
    docs.push('dea', 'board_certification');
  } else if (cred === 'LPC' || cred === 'LCSW' || cred === 'MFT') {
    docs.push('counseling_license');
  }

  return docs;
}

function getDSRate(credentials: string | null | undefined): number {
  const cred = (credentials ?? '').toUpperCase().split(/[/,\s]/)[0].trim();
  return DS_RATES[cred] ?? 105;
}
function getEmpRate(credentials: string | null | undefined): number {
  const cred = (credentials ?? '').toUpperCase().split(/[/,\s]/)[0].trim();
  return EMP_RATES[cred] ?? 80;
}

const DOC_LABELS: Record<DocType, string> = {
  state_license:        'State License',
  malpractice:          'Malpractice Insurance',
  dea:                  'DEA Registration',
  caqh:                 'CAQH Profile',
  cv:                   'CV / Resume',
  collab_agreement:     'Collaborative Agreement',
  board_certification:  'Board Certification',
  background_check:     'Background Check',
  prescriptive_authority: 'Prescriptive Authority',
  counseling_license:   'Counseling License',
};

// ── Data hooks ────────────────────────────────────────────────────────────────

function useContractors() {
  return useQuery({
    queryKey: ['contractors'],
    queryFn: async () => {
      const [profilesRes, opsInfoRes, homebaseRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, credentials, profession, employment_status, employment_type, agency_id')
          .neq('employment_status', 'termed'),
        supabase
          .from('provider_ops_info')
          .select('profile_id, hourly_rate, employment_type, contractor_org'),
        supabase
          .from('homebase_employees')
          .select('profile_id, homebase_id')
          .not('profile_id', 'is', null),
      ]);

      const opsInfoMap = new Map<string, any>(
        (opsInfoRes.data ?? []).map((r: any) => [r.profile_id, r])
      );
      const homebaseMap = new Map<string, string>(
        (homebaseRes.data ?? []).map((r: any) => [r.profile_id, r.homebase_id])
      );

      return (profilesRes.data ?? []).map((p: any) => {
        const ops = opsInfoMap.get(p.id);
        const isContractor =
          ops?.employment_type === 'contractor' ||
          p.employment_type === 'contractor' ||
          p.agency_id !== null;
        return {
          ...p,
          ops,
          homebaseId: homebaseMap.get(p.id) ?? null,
          isContractor,
          contractorOrg: ops?.contractor_org ?? (p.agency_id ? 'Agency' : null),
        };
      });
    },
    staleTime: 5 * 60_000,
  });
}

function useProviderActiveStates() {
  return useQuery({
    queryKey: ['provider_active_states_strategy'],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      const { data, error } = await supabase
        .from('license_optimization_snapshots')
        .select('profile_id, state_abbreviation, allocated_hours, quadrant')
        .gte('snapshot_date', cutoff.toISOString().slice(0, 10));
      if (error) throw error;
      const map = new Map<string, { states: Set<string>; totalHours: number }>();
      for (const r of data ?? []) {
        if (!map.has(r.profile_id)) map.set(r.profile_id, { states: new Set(), totalHours: 0 });
        const entry = map.get(r.profile_id)!;
        entry.states.add(r.state_abbreviation);
        entry.totalHours += Number(r.allocated_hours ?? 0);
      }
      return map;
    },
    staleTime: 5 * 60_000,
  });
}

function useComplianceDocs() {
  return useQuery({
    queryKey: ['contractor_compliance_docs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractor_compliance_docs')
        .select('*');
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: 2 * 60_000,
  });
}

function useActiveStates() {
  return useQuery({
    queryKey: ['state_activation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('state_activation')
        .select('state_abbreviation, is_active')
        .eq('is_active', true);
      if (error) throw error;
      return new Set<string>((data ?? []).map((r: any) => r.state_abbreviation));
    },
    staleTime: 5 * 60_000,
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DocStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'verified':   return <StatusChip tone="active"   label="Verified" />;
    case 'submitted':  return <StatusChip tone="info"     label="Submitted" />;
    case 'rejected':   return <StatusChip tone="error"    label="Rejected" />;
    case 'expired':    return <StatusChip tone="warning"  label="Expired" />;
    default:           return <StatusChip tone="inactive" label="Pending" />;
  }
}

function KpiCard({
  title, value, sub, icon: Icon, color,
}: {
  title: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={cn('rounded-lg p-2 shrink-0', color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ContractorStrategyPage() {
  const { profile, roles } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const { data: allProviders = [], isLoading: loadingProviders, refetch } = useContractors();
  const { data: providerStates = new Map() } = useProviderActiveStates();
  const { data: complianceDocs = [], isLoading: loadingDocs } = useComplianceDocs();
  const { data: activeStates = new Set<string>() } = useActiveStates();

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [docStatusUpdating, setDocStatusUpdating] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // ── Derived: contractor vs employee split ──────────────────────────────────

  const contractors = useMemo(
    () => allProviders.filter((p) => p.isContractor),
    [allProviders]
  );
  const employees = useMemo(
    () => allProviders.filter((p) => !p.isContractor),
    [allProviders]
  );

  // ── Decision Analysis: cost + coverage ────────────────────────────────────

  const decisionData = useMemo(() => {
    // Weekly hours per provider (from snapshots, 14-day window → weekly avg)
    const weeklyHours = (pid: string) =>
      (providerStates.get(pid)?.totalHours ?? 0) / 2;  // 14 days ÷ 2 = 1 week

    const contractorWeeklyHours = contractors.reduce(
      (s, p) => s + weeklyHours(p.id), 0
    );
    const employeeWeeklyHours = employees.reduce(
      (s, p) => s + weeklyHours(p.id), 0
    );

    // Monthly cost (4.33 weeks/month)
    const contractorMonthlyCost = contractors.reduce((s, p) => {
      const hrs = weeklyHours(p.id) * 4.33;
      return s + hrs * getDSRate(p.credentials);
    }, 0);

    const employeeEquivCost = contractors.reduce((s, p) => {
      const hrs = weeklyHours(p.id) * 4.33;
      return s + hrs * getEmpRate(p.credentials);
    }, 0);

    // States exclusively covered by contractors (no employee licensed there)
    const employeeStateSet = new Set<string>();
    for (const p of employees) {
      for (const s of (providerStates.get(p.id)?.states ?? new Set())) {
        employeeStateSet.add(s);
      }
    }
    const contractorExclusiveStates: string[] = [];
    for (const p of contractors) {
      for (const s of (providerStates.get(p.id)?.states ?? new Set())) {
        if (!employeeStateSet.has(s) && activeStates.has(s)) {
          if (!contractorExclusiveStates.includes(s)) contractorExclusiveStates.push(s);
        }
      }
    }

    // Compliance overhead estimate
    const docVerificationsNeeded = contractors.reduce((s, p) => {
      const stateCount = (providerStates.get(p.id)?.states ?? new Set()).size;
      const docsPerState = generateChecklist(p.credentials, 'TX').length; // avg
      return s + stateCount * docsPerState;
    }, 0);
    const verificationHoursPerMonth = (docVerificationsNeeded * 0.5) / 12; // 30 min each, amortized

    // Hiring recommendation to replace DS
    const uniqueContractorStates = new Set<string>();
    for (const p of contractors) {
      for (const s of (providerStates.get(p.id)?.states ?? new Set())) {
        if (activeStates.has(s)) uniqueContractorStates.add(s);
      }
    }
    const avgStatesPerNP = 4;
    const npNeededToReplace = Math.ceil(uniqueContractorStates.size / avgStatesPerNP);

    return {
      contractorCount: contractors.length,
      employeeCount: employees.length,
      contractorWeeklyHours: Math.round(contractorWeeklyHours),
      employeeWeeklyHours: Math.round(employeeWeeklyHours),
      contractorMonthlyCost: Math.round(contractorMonthlyCost),
      employeeEquivCost: Math.round(employeeEquivCost),
      premium: Math.round(contractorMonthlyCost - employeeEquivCost),
      contractorExclusiveStates,
      docVerificationsNeeded,
      verificationHoursPerMonth: Math.round(verificationHoursPerMonth * 10) / 10,
      npNeededToReplace,
      uniqueContractorStates: [...uniqueContractorStates].sort(),
    };
  }, [contractors, employees, providerStates, activeStates]);

  // ── Compliance tracker data ────────────────────────────────────────────────

  const contractorCompliance = useMemo(() => {
    return contractors.map((p) => {
      const states = [...(providerStates.get(p.id)?.states ?? new Set())].filter(
        (s) => activeStates.has(s)
      );
      const totalDocs = states.reduce(
        (s, state) => s + generateChecklist(p.credentials, state).length, 0
      );
      const verifiedDocs = complianceDocs.filter(
        (d) => d.profile_id === p.id && d.status === 'verified'
      ).length;
      const submittedDocs = complianceDocs.filter(
        (d) => d.profile_id === p.id && (d.status === 'submitted' || d.status === 'verified')
      ).length;
      const readinessPct = totalDocs > 0 ? Math.round((verifiedDocs / totalDocs) * 100) : 0;

      return { ...p, states, totalDocs, verifiedDocs, submittedDocs, readinessPct };
    }).sort((a, b) => a.readinessPct - b.readinessPct);
  }, [contractors, providerStates, complianceDocs, activeStates]);

  // ── Intake: selected provider's checklist ─────────────────────────────────

  const selectedProvider = useMemo(
    () => allProviders.find((p) => p.id === selectedProfileId) ?? null,
    [allProviders, selectedProfileId]
  );

  const selectedChecklist = useMemo(() => {
    if (!selectedProvider) return [];
    const states = [...(providerStates.get(selectedProvider.id)?.states ?? new Set())].filter(
      (s) => activeStates.has(s)
    );
    return states.map((state) => {
      const docs = generateChecklist(selectedProvider.credentials, state);
      return {
        state,
        authority: NP_AUTHORITY[state] ?? null,
        docs: docs.map((docType) => {
          const existing = complianceDocs.find(
            (d) => d.profile_id === selectedProvider.id &&
              d.state_abbreviation === state &&
              d.doc_type === docType
          );
          return { docType, status: existing?.status ?? 'pending', id: existing?.id ?? null };
        }),
      };
    });
  }, [selectedProvider, providerStates, complianceDocs, activeStates]);

  // ── Coverage bridge calculation ───────────────────────────────────────────

  const bridgePlan = useMemo(() => {
    // States where contractors provide ≥ 40% of total coverage hours
    const stateContractorHours = new Map<string, number>();
    const stateTotalHours = new Map<string, number>();

    for (const p of allProviders) {
      const stateData = providerStates.get(p.id);
      if (!stateData) continue;
      const hrsPerState = stateData.totalHours / Math.max(stateData.states.size, 1) / 2;
      for (const state of stateData.states) {
        if (!activeStates.has(state)) continue;
        stateTotalHours.set(state, (stateTotalHours.get(state) ?? 0) + hrsPerState);
        if (p.isContractor) {
          stateContractorHours.set(state, (stateContractorHours.get(state) ?? 0) + hrsPerState);
        }
      }
    }

    const atRiskStates: {
      state: string; contractorHrs: number; totalHrs: number;
      contractorPct: number; bridgeHrsNeeded: number; weeklyCost: number;
    }[] = [];

    for (const [state, total] of stateTotalHours) {
      const contractorHrs = stateContractorHours.get(state) ?? 0;
      const pct = total > 0 ? contractorHrs / total : 0;
      if (pct >= 0.4) {
        const bridgeHrs = contractorHrs * 0.6;   // 60% of contractor hours as admin bridge
        atRiskStates.push({
          state,
          contractorHrs: Math.round(contractorHrs * 10) / 10,
          totalHrs: Math.round(total * 10) / 10,
          contractorPct: Math.round(pct * 100),
          bridgeHrsNeeded: Math.round(bridgeHrs * 10) / 10,
          weeklyCost: Math.round(bridgeHrs * ADMIN_BRIDGE_RATE),
        });
      }
    }

    const totalBridgeHrs = atRiskStates.reduce((s, r) => s + r.bridgeHrsNeeded, 0);
    const weeklyBridgeCost = atRiskStates.reduce((s, r) => s + r.weeklyCost, 0);

    return {
      atRiskStates: atRiskStates.sort((a, b) => b.contractorPct - a.contractorPct),
      totalBridgeHrs: Math.round(totalBridgeHrs * 10) / 10,
      weeklyBridgeCost,
      transitionWeeks: 12,   // estimated credentialing + hiring timeline
      totalBridgeCost: Math.round(weeklyBridgeCost * 12),
    };
  }, [allProviders, providerStates, activeStates]);

  // ── Doc status update mutation ────────────────────────────────────────────

  const updateDocMutation = useMutation({
    mutationFn: async ({
      profileId, state, docType, status,
    }: { profileId: string; state: string; docType: DocType; status: string }) => {
      const { error } = await supabase
        .from('contractor_compliance_docs')
        .upsert({
          profile_id: profileId,
          state_abbreviation: state,
          doc_type: docType,
          status,
          ...(status === 'verified' ? { verified_at: new Date().toISOString(), verified_by_id: profile?.id } : {}),
          ...(status === 'submitted' ? { submitted_at: new Date().toISOString() } : {}),
        }, { onConflict: 'profile_id,state_abbreviation,doc_type' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contractor_compliance_docs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
    },
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />

      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8 space-y-6">

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Contractor Strategy</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Make-vs-buy analysis, DS compliance tracking, and coverage bridge planning
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* How to use guide */}
          <Collapsible open={showGuide} onOpenChange={setShowGuide}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground -mt-2 mb-1 h-7 px-2 text-xs">
                <Info className="h-3.5 w-3.5" />
                How to use this page
                <ChevronDown className={cn('h-3 w-3 transition-transform', showGuide && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Alert className="mb-4 bg-muted/40 border-border">
                <AlertDescription className="text-sm space-y-3">
                  <p className="font-semibold text-foreground">Purpose: decide when to use contractors vs. employees to fill coverage gaps, track contractor compliance, and plan bridge coverage for new state launches.</p>
                  <div className="space-y-2 text-muted-foreground">
                    <p><span className="font-medium text-foreground">Decision Analysis tab</span> — the make-vs-buy model compares the fully-loaded cost of a W2 provider against a contractor for a given state's demand. Use it when the Demand Matching Engine shows a persistent gap in a state and you need to decide whether to hire, license an existing provider, or bring in a contractor. A contractor makes financial sense when demand is uncertain or the gap is temporary ({'<'} 3 months).</p>
                    <p><span className="font-medium text-foreground">Compliance Tracker tab</span> — per-contractor document status (W9, insurance, NPI, state registrations). Each doc shows expiry date and status. Flag expiring docs proactively — a contractor with lapsed insurance creates compliance risk. Filter by contractor to do a readiness audit before activating them in a new state.</p>
                    <p><span className="font-medium text-foreground">DS Intake tab</span> — onboarding checklist for new direct-source (DS) contractors. Walk through each item to track their readiness. Link to their profile for credential tracking.</p>
                    <p><span className="font-medium text-foreground">Coverage Bridge tab</span> — plan temporary contractor coverage for states with known demand spikes or new launches. Map bridge periods against the demand forecast to right-size contractor hours. Cross-reference with the <a href="/admin/matching" className="underline text-primary">Demand Matching Engine</a> to see if contractor hours close the gap.</p>
                  </div>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">For leadership:</span>
                    {' '}The Decision Analysis cost comparison is the key metric for make-vs-buy budget conversations. Compliance Tracker shows contractor risk exposure. Coverage Bridge shows how contractor spend maps to specific time-bounded needs.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

          <Tabs defaultValue="decision">
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="decision">Decision Analysis</TabsTrigger>
              <TabsTrigger value="tracker">Compliance Tracker</TabsTrigger>
              <TabsTrigger value="intake">DS Intake</TabsTrigger>
              <TabsTrigger value="bridge">Coverage Bridge</TabsTrigger>
            </TabsList>

            {/* ── 1. Decision Analysis ─────────────────────────────────────── */}
            <TabsContent value="decision" className="space-y-5 mt-4">

              {/* Provider mix */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard
                  title="DS Contractors"
                  value={decisionData.contractorCount}
                  sub={`${decisionData.contractorWeeklyHours}h/wk`}
                  icon={Users} color="bg-orange-500"
                />
                <KpiCard
                  title="Employees"
                  value={decisionData.employeeCount}
                  sub={`${decisionData.employeeWeeklyHours}h/wk`}
                  icon={Users} color="bg-primary"
                />
                <KpiCard
                  title="DS Monthly Cost"
                  value={`$${(decisionData.contractorMonthlyCost / 1000).toFixed(1)}k`}
                  sub="at DS hourly rates"
                  icon={DollarSign} color="bg-destructive"
                />
                <KpiCard
                  title="Employee Equiv Cost"
                  value={`$${(decisionData.employeeEquivCost / 1000).toFixed(1)}k`}
                  sub="at loaded W2 rates"
                  icon={DollarSign} color="bg-emerald-500"
                />
              </div>

              {/* Cost premium */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Make vs. Buy — Cost Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 p-4 rounded-lg border bg-muted/30">
                    {decisionData.premium > 0 ? (
                      <TrendingUp className="h-6 w-6 text-destructive shrink-0" />
                    ) : (
                      <TrendingDown className="h-6 w-6 text-emerald-500 shrink-0" />
                    )}
                    <div>
                      <p className="font-semibold">
                        DS costs{' '}
                        <span className={decisionData.premium > 0 ? 'text-destructive' : 'text-emerald-600'}>
                          ${Math.abs(decisionData.premium).toLocaleString()}/month more
                        </span>{' '}
                        than equivalent employees
                      </p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        DS: ${decisionData.contractorMonthlyCost.toLocaleString()} · Employee equiv: ${decisionData.employeeEquivCost.toLocaleString()}
                        {' '}· Annual difference: ${(Math.abs(decisionData.premium) * 12).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="p-3 rounded-lg border bg-orange-50 dark:bg-orange-950/20 border-orange-200">
                      <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                        Compliance Overhead
                      </p>
                      <p className="text-lg font-bold mt-1">
                        {decisionData.verificationHoursPerMonth}h/month
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {decisionData.docVerificationsNeeded} doc verifications needed
                        across {decisionData.contractorCount} DS providers
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200">
                      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                        DS Exclusive Coverage
                      </p>
                      <p className="text-lg font-bold mt-1">
                        {decisionData.contractorExclusiveStates.length} states
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {decisionData.contractorExclusiveStates.slice(0, 6).join(', ')}
                        {decisionData.contractorExclusiveStates.length > 6 && '…'}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200">
                      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                        To Replace DS: Hire
                      </p>
                      <p className="text-lg font-bold mt-1">
                        ~{decisionData.npNeededToReplace} NPs
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        across {decisionData.uniqueContractorStates.length} DS-covered states
                        · 3–6 month credential timeline
                      </p>
                    </div>
                  </div>

                  {/* Recommendation */}
                  <div className="p-4 rounded-lg border-l-4 border-primary bg-primary/5">
                    <p className="text-sm font-semibold mb-2">Recommendation framework</p>
                    <ul className="text-sm space-y-1.5 text-muted-foreground">
                      <li>
                        <span className="font-medium text-foreground">If compliance overhead {'>'} 8h/month</span>
                        {' '}→ DS partnership ROI is negative; begin hiring pipeline for high-volume DS states
                      </li>
                      <li>
                        <span className="font-medium text-foreground">If DS exclusive states {'>'} 5</span>
                        {' '}→ DS still earns its premium; negotiate structured intake SLA rather than eliminating
                      </li>
                      <li>
                        <span className="font-medium text-foreground">If DS exclusive states ≤ 3</span>
                        {' '}→ phase out DS, credential existing employees in those states, use bridge plan during transition
                      </li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── 2. Compliance Tracker ─────────────────────────────────────── */}
            <TabsContent value="tracker" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    DS Provider Compliance Readiness
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={() =>
                      downloadCSV(
                        contractorCompliance.map((p) => ({
                          name: p.full_name ?? '',
                          credentials: p.credentials ?? p.profession ?? '',
                          org: p.contractorOrg ?? '',
                          active_states: p.states.join(';'),
                          docs_verified: p.verifiedDocs,
                          docs_total: p.totalDocs,
                          readiness_pct: p.readinessPct,
                        })),
                        'ds_compliance_readiness.csv',
                      )
                    }
                  >
                    <Download className="h-3 w-3" /> Export
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingProviders || loadingDocs ? (
                    <div className="p-8 text-center text-muted-foreground">Loading…</div>
                  ) : contractorCompliance.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      No contractors found. Tag providers as contractors in the Ops tab of the Directory.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Provider</th>
                            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Org</th>
                            <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Active States</th>
                            <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Docs Verified</th>
                            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Readiness</th>
                            <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contractorCompliance.map((p) => (
                            <tr
                              key={p.id}
                              className={cn(
                                'border-b hover:bg-muted/30 transition-colors',
                                p.readinessPct === 0 && p.totalDocs > 0 && 'bg-destructive/5',
                              )}
                            >
                              <td className="px-4 py-2.5">
                                <div className="font-medium">{p.full_name ?? '—'}</div>
                                <div className="text-xs text-muted-foreground">
                                  {p.credentials ?? p.profession ?? ''}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-sm text-muted-foreground">
                                {p.contractorOrg ?? '—'}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <div className="flex flex-wrap gap-0.5 justify-center">
                                  {p.states.slice(0, 5).map((s: string) => (
                                    <Badge key={s} variant="outline" className="text-xs px-1">{s}</Badge>
                                  ))}
                                  {p.states.length > 5 && (
                                    <Badge variant="outline" className="text-xs px-1">
                                      +{p.states.length - 5}
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-center font-mono text-sm">
                                {p.verifiedDocs}/{p.totalDocs}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <span
                                  className={cn(
                                    'font-bold text-sm',
                                    p.readinessPct >= 80 ? 'text-emerald-600' :
                                    p.readinessPct >= 40 ? 'text-yellow-600' : 'text-destructive',
                                  )}
                                >
                                  {p.readinessPct}%
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  onClick={() => setSelectedProfileId(p.id)}
                                >
                                  Review
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── 3. DS Intake Workflow ────────────────────────────────────── */}
            <TabsContent value="intake" className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">
                    Select a DS provider to view their auto-generated state compliance checklist.
                    Checklists are generated based on credential type and state practice authority.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Provider picker */}
                <Card className="lg:col-span-1">
                  <CardHeader>
                    <CardTitle className="text-sm">DS Providers</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {contractors.map((p) => {
                        const cc = contractorCompliance.find((c) => c.id === p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={() => setSelectedProfileId(p.id)}
                            className={cn(
                              'w-full px-4 py-3 text-left hover:bg-muted/40 transition-colors',
                              selectedProfileId === p.id && 'bg-primary/10',
                            )}
                          >
                            <div className="font-medium text-sm">{p.full_name ?? '—'}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground">
                                {p.credentials ?? ''}
                              </span>
                              {cc && (
                                <span
                                  className={cn(
                                    'text-xs font-semibold',
                                    cc.readinessPct >= 80 ? 'text-emerald-600' :
                                    cc.readinessPct >= 40 ? 'text-yellow-600' : 'text-destructive',
                                  )}
                                >
                                  {cc.readinessPct}% ready
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                      {contractors.length === 0 && (
                        <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                          No contractors found.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Checklist */}
                <div className="lg:col-span-2 space-y-3">
                  {!selectedProvider ? (
                    <Card>
                      <CardContent className="p-8 text-center text-muted-foreground">
                        <Zap className="h-8 w-8 mx-auto mb-3 opacity-30" />
                        <p>Select a provider to view their AI-generated compliance checklist</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold">{selectedProvider.full_name}</h3>
                        <Badge variant="outline" className="text-xs">
                          {selectedProvider.credentials ?? selectedProvider.profession}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Auto-generated checklist · {selectedChecklist.length} active states
                        </span>
                      </div>

                      {selectedChecklist.map(({ state, authority, docs }) => (
                        <Card key={state}>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <span className="font-bold">{state}</span>
                              {authority && (
                                <Badge
                                  className={cn(
                                    'text-xs',
                                    authority === 'full'       && 'bg-emerald-500 text-white',
                                    authority === 'reduced'    && 'bg-yellow-500 text-white',
                                    authority === 'restricted' && 'bg-red-500 text-white',
                                  )}
                                >
                                  {authority}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground font-normal ml-auto">
                                {docs.filter((d) => d.status === 'verified').length}/{docs.length} verified
                              </span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-1.5">
                              {docs.map(({ docType, status, id }) => (
                                <div
                                  key={docType}
                                  className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-muted/30"
                                >
                                  {status === 'verified' ? (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                                  ) : status === 'submitted' ? (
                                    <Clock className="h-4 w-4 text-blue-500 shrink-0" />
                                  ) : status === 'rejected' ? (
                                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                                  ) : (
                                    <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
                                  )}
                                  <span className="text-sm flex-1">{DOC_LABELS[docType]}</span>
                                  <div className="flex items-center gap-1">
                                    <DocStatusBadge status={status} />
                                    {status !== 'verified' && (
                                      <button
                                        onClick={() =>
                                          updateDocMutation.mutate({
                                            profileId: selectedProvider.id,
                                            state,
                                            docType,
                                            status: status === 'pending' ? 'submitted'
                                              : status === 'submitted' ? 'verified'
                                              : 'verified',
                                          })
                                        }
                                        disabled={updateDocMutation.isPending}
                                        className="text-xs text-primary hover:underline ml-1"
                                      >
                                        {status === 'pending' ? 'Mark submitted'
                                          : status === 'submitted' ? 'Verify'
                                          : 'Mark verified'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                      {selectedChecklist.length === 0 && (
                        <Card>
                          <CardContent className="p-6 text-center text-muted-foreground text-sm">
                            No active states found for this provider in the last 14 days.
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ── 4. Coverage Bridge ───────────────────────────────────────── */}
            <TabsContent value="bridge" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard
                  title="States at Risk"
                  value={bridgePlan.atRiskStates.length}
                  sub="if DS removed"
                  icon={AlertTriangle} color="bg-orange-500"
                />
                <KpiCard
                  title="Bridge Hours/Wk"
                  value={bridgePlan.totalBridgeHrs}
                  sub="clinical admin coverage"
                  icon={Clock} color="bg-blue-500"
                />
                <KpiCard
                  title="Bridge Cost/Wk"
                  value={`$${bridgePlan.weeklyBridgeCost.toLocaleString()}`}
                  sub={`@ $${ADMIN_BRIDGE_RATE}/hr admin`}
                  icon={DollarSign} color="bg-primary"
                />
                <KpiCard
                  title="Total Bridge Cost"
                  value={`$${bridgePlan.totalBridgeCost.toLocaleString()}`}
                  sub={`~${bridgePlan.transitionWeeks} wk transition`}
                  icon={DollarSign} color="bg-emerald-500"
                />
              </div>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">
                    Interim Coverage Plan — States Where DS {'>'} 40% of Hours
                  </CardTitle>
                  {bridgePlan.atRiskStates.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() =>
                        downloadCSV(
                          bridgePlan.atRiskStates.map((r) => ({
                            state: r.state,
                            ds_hrs_wk: r.contractorHrs,
                            total_hrs_wk: r.totalHrs,
                            ds_pct: r.contractorPct,
                            bridge_hrs_wk: r.bridgeHrsNeeded,
                            bridge_cost_wk: r.weeklyCost,
                          })),
                          'coverage_bridge_plan.csv',
                        )
                      }
                    >
                      <Download className="h-3 w-3" /> Export
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {bridgePlan.atRiskStates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No states are predominantly dependent on contractors.
                      Coverage bridge is not needed.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        These states have ≥ 40% of their weekly provider hours supplied by DS contractors.
                        Removing DS without a bridge would drop same-day/next-day SLA below target.
                        Bridge hours represent additional clinical admin coverage needed during the
                        transition period.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">State</th>
                              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">DS Hrs/Wk</th>
                              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total Hrs/Wk</th>
                              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">DS %</th>
                              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Bridge Hrs/Wk</th>
                              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Bridge Cost/Wk</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bridgePlan.atRiskStates.map((r) => (
                              <tr
                                key={r.state}
                                className={cn(
                                  'border-b hover:bg-muted/30 transition-colors',
                                  r.contractorPct >= 70 && 'bg-destructive/5',
                                )}
                              >
                                <td className="px-4 py-2.5 font-semibold">{r.state}</td>
                                <td className="px-4 py-2.5 text-right font-mono">{r.contractorHrs}</td>
                                <td className="px-4 py-2.5 text-right font-mono">{r.totalHrs}</td>
                                <td className="px-4 py-2.5 text-right">
                                  <span className={cn(
                                    'font-bold text-sm',
                                    r.contractorPct >= 70 ? 'text-destructive' :
                                    r.contractorPct >= 50 ? 'text-orange-600' : 'text-yellow-600',
                                  )}>
                                    {r.contractorPct}%
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono">{r.bridgeHrsNeeded}</td>
                                <td className="px-4 py-2.5 text-right font-mono">
                                  ${r.weeklyCost.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="p-3 rounded-lg border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-950/20 text-sm">
                        <p className="font-semibold mb-1">Recommended transition plan</p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                          <li>Immediately increase clinical admin hours in the {bridgePlan.atRiskStates.filter(r => r.contractorPct >= 70).length} highest-risk states (≥70% DS-dependent)</li>
                          <li>Open hiring reqs for ~{decisionData.npNeededToReplace} NPs with multi-state licenses covering DS-exclusive states</li>
                          <li>Maintain DS engagement at current levels for {bridgePlan.transitionWeeks} weeks while credentialing new hires</li>
                          <li>Implement DS Intake checklist (Intake tab) as condition of continued partnership to reduce compliance overhead</li>
                          <li>Re-evaluate DS renewal at 90-day checkpoint using Decision Analysis tab</li>
                        </ol>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        </div>
      </main>
    </div>
  );
}
