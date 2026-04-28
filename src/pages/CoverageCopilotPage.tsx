import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Sparkles, CheckCircle2, AlertTriangle, XCircle, ChevronDown, Copy, MessageSquare, Calendar, TrendingDown, TrendingUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Recommendation {
  recommendation: 'approve_full' | 'approve_partial' | 'decline';
  approved_hours: number;
  suggested_window?: { start_local: string; end_local: string } | null;
  primary_state?: string | null;
  reasons: string[];
  conditional_yes?: { action: 'activate'; state: string; reason: string }[];
  conditional_no?: { action: 'deactivate'; state: string; reason: string }[];
  confidence: 'high' | 'medium' | 'low';
  summary: string;
}
interface CopilotResponse {
  mode?: 'provider' | 'network';
  extracted?: Record<string, unknown>;
  facts?: any;
  recommendation?: Recommendation;
  network_answer?: NetworkAnswer;
  error?: string;
  candidates?: { id: string; name: string; email: string }[];
}

interface NetworkAnswer {
  headline: string;
  summary: string;
  highlighted_date?: string;
  key_states?: string[];
  reasons: string[];
  suggested_actions?: string[];
  confidence: 'high' | 'medium' | 'low';
}

const SAMPLES = [
  'Mandy wants to work additional hours on May 1st from 10am-5pm EST. Do we need her hours?',
  'When is the next date with coverage gaps?',
  'Which states are short on coverage this week?',
  'Do we have surplus capacity on Friday?',
];

function recBadge(rec: Recommendation['recommendation']) {
  const map = {
    approve_full: { label: 'Approve full', icon: CheckCircle2, cls: 'bg-emerald-500 text-white' },
    approve_partial: { label: 'Approve partial', icon: AlertTriangle, cls: 'bg-yellow-500 text-white' },
    decline: { label: 'Decline', icon: XCircle, cls: 'bg-destructive text-destructive-foreground' },
  } as const;
  const m = map[rec];
  const Icon = m.icon;
  return (
    <Badge className={cn(m.cls, 'gap-1.5 px-2.5 py-1 text-sm')}>
      <Icon className="h-3.5 w-3.5" />
      {m.label}
    </Badge>
  );
}

export default function CoverageCopilotPage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin' : 'admin'; // page is admin-gated
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [response, setResponse] = useState<CopilotResponse | null>(null);

  const mutation = useMutation({
    mutationFn: async (question: string): Promise<CopilotResponse> => {
      const { data, error } = await supabase.functions.invoke('coverage-copilot', {
        body: { question },
      });
      if (error) {
        // Try to surface 402/429 messages embedded in non-2xx responses
        const ctx = (error as any).context;
        let parsed: any = null;
        if (ctx?.body) {
          try { parsed = JSON.parse(ctx.body); } catch { /* */ }
        }
        throw new Error(parsed?.error ?? error.message ?? 'Request failed');
      }
      return data;
    },
    onSuccess: (data) => {
      setResponse(data);
      if (data.error) {
        toast({ title: 'Need more info', description: data.error });
      }
    },
    onError: (err: any) => {
      const msg = err?.message ?? 'Unknown error';
      toast({ title: 'Copilot error', description: msg, variant: 'destructive' });
    },
  });

  const handleSubmit = () => {
    const q = input.trim();
    if (!q) return;
    setResponse(null);
    mutation.mutate(q);
  };

  const copySummary = async () => {
    if (!response?.recommendation?.summary) return;
    await navigator.clipboard.writeText(response.recommendation.summary);
    toast({ title: 'Copied to clipboard' });
  };

  const rec = response?.recommendation;
  const net = response?.network_answer;

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole}
        userName={profile?.full_name ?? undefined}
        userEmail={profile?.email ?? undefined}
        userAvatarUrl={profile?.avatar_url ?? undefined}
      />
      <div className="ml-0 sm:ml-16 lg:ml-64 p-6 max-w-5xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Coverage Copilot</h1>
            <Badge variant="outline" className="text-xs">Beta</Badge>
          </div>
          <p className="text-muted-foreground">
            Ask shift-approval questions in plain English. The copilot grounds every answer in
            today's coverage data — gaps, surplus, licensure, and EHR activation status.
          </p>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6 space-y-3">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="e.g. Mandy wants to work additional hours on May 1st from 10am-5pm EST. Do we need her hours?"
              rows={3}
              className="resize-none"
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
            />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-wrap gap-1.5">
                {SAMPLES.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setInput(s)}
                    className="text-xs text-muted-foreground hover:text-foreground border border-dashed rounded px-2 py-0.5"
                  >
                    Try: "{s.slice(0, 40)}…"
                  </button>
                ))}
              </div>
              <Button
                onClick={handleSubmit}
                disabled={mutation.isPending || !input.trim()}
              >
                {mutation.isPending ? 'Thinking…' : 'Ask Copilot'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to submit</p>
          </CardContent>
        </Card>

        {/* Disambiguation / parse errors */}
        {response?.error && response.candidates && response.candidates.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Which provider did you mean?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">{response.error}</p>
              {response.candidates.map(c => (
                <button
                  key={c.id}
                  className="w-full text-left rounded border p-2 hover:bg-accent text-sm"
                  onClick={() => {
                    const q = `${input.trim()} (use ${c.name})`;
                    setInput(q);
                  }}
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {response?.error && (!response.candidates || response.candidates.length === 0) && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{response.error}</AlertDescription>
          </Alert>
        )}

        {/* Network-mode answer */}
        {net && response && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    Network insight
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Confidence: <span className="capitalize">{net.confidence}</span>
                    {response.facts?.scan_range && (
                      <> · Scanned {response.facts.scan_range.start_date} → {response.facts.scan_range.end_date}</>
                    )}
                  </p>
                </div>
                {net.highlighted_date && (
                  <Badge variant="secondary">{net.highlighted_date}</Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-lg font-medium">{net.headline}</div>
                <div className="rounded-md bg-muted p-3 text-sm flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <p>{net.summary}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await navigator.clipboard.writeText(net.summary);
                      toast({ title: 'Copied to clipboard' });
                    }}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                  </Button>
                </div>
                {net.key_states && net.key_states.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {net.key_states.map(s => (
                      <Badge key={s} variant="outline">{s}</Badge>
                    ))}
                  </div>
                )}
                {net.reasons?.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Why</div>
                    <ul className="text-sm space-y-1 list-disc pl-5">
                      {net.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                {net.suggested_actions && net.suggested_actions.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Suggested actions</div>
                    <ul className="text-sm space-y-1 list-disc pl-5">
                      {net.suggested_actions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid sm:grid-cols-2 gap-4">
              {response.facts?.top_gap_states?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <TrendingDown className="h-4 w-4 text-destructive" />
                      Top gap states
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {response.facts.top_gap_states.map((s: any) => (
                      <div key={s.state} className="text-sm flex justify-between">
                        <span><Badge variant="outline" className="mr-2">{s.state}</Badge>{s.days_with_gaps} day(s) short</span>
                        <span className="font-medium">{s.gap_hours}h</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {response.facts?.top_surplus_states?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <TrendingUp className="h-4 w-4 text-emerald-500" />
                      Top surplus states
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {response.facts.top_surplus_states.map((s: any) => (
                      <div key={s.state} className="text-sm flex justify-between">
                        <Badge variant="outline">{s.state}</Badge>
                        <span className="font-medium">{s.surplus_hours}h</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Facts viewer */}
            <Card>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-4 text-sm hover:bg-accent rounded-t-lg">
                    <span className="font-medium">Facts used</span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <pre className="text-[11px] bg-muted rounded p-3 overflow-x-auto max-h-[400px]">
                      {JSON.stringify(response.facts, null, 2)}
                    </pre>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </div>
        )}

        {/* Recommendation */}
        {rec && response && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    Recommendation
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Confidence: <span className="capitalize">{rec.confidence}</span>
                  </p>
                </div>
                {recBadge(rec.recommendation)}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <div>
                    <div className="text-3xl font-semibold">{rec.approved_hours}h</div>
                    <div className="text-xs text-muted-foreground">approved</div>
                  </div>
                  {rec.suggested_window && (
                    <div className="text-sm">
                      Suggested window:{' '}
                      <span className="font-medium">
                        {rec.suggested_window.start_local}–{rec.suggested_window.end_local}
                      </span>
                    </div>
                  )}
                  {rec.primary_state && (
                    <Badge variant="secondary">Primary: {rec.primary_state}</Badge>
                  )}
                </div>

                <div className="rounded-md bg-muted p-3 text-sm flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <p>{rec.summary}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={copySummary}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                  </Button>
                </div>

                {rec.reasons?.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Why</div>
                    <ul className="text-sm space-y-1 list-disc pl-5">
                      {rec.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            {(rec.conditional_yes?.length || rec.conditional_no?.length) ? (
              <div className="grid sm:grid-cols-2 gap-4">
                {rec.conditional_yes && rec.conditional_yes.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Yes — IF you activate
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {rec.conditional_yes.map((c, i) => (
                        <div key={i} className="text-sm">
                          <Badge variant="outline" className="mr-2">{c.state}</Badge>
                          {c.reason}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
                {rec.conditional_no && rec.conditional_no.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-1.5">
                        <XCircle className="h-4 w-4 text-orange-500" />
                        No — unless you deactivate
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {rec.conditional_no.map((c, i) => (
                        <div key={i} className="text-sm">
                          <Badge variant="outline" className="mr-2">{c.state}</Badge>
                          {c.reason}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : null}

            {/* Facts viewer */}
            <Card>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-4 text-sm hover:bg-accent rounded-t-lg">
                    <span className="font-medium">Facts used</span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <pre className="text-[11px] bg-muted rounded p-3 overflow-x-auto max-h-[400px]">
                      {JSON.stringify(response.facts, null, 2)}
                    </pre>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}