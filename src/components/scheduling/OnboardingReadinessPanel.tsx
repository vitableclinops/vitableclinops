import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertCircle, Check, Loader2, UserCheck, X } from 'lucide-react';
import {
  useOnboardingReadiness,
  type ProviderReadiness,
} from '@/hooks/useMonthlyPublish';

const formatDateShort = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

function CheckCell({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100">
      <Check className="h-3.5 w-3.5 text-emerald-700" />
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100">
      <X className="h-3.5 w-3.5 text-red-700" />
    </span>
  );
}

export function OnboardingReadinessPanel() {
  const [lookbackDays, setLookbackDays] = useState<number>(30);
  const { data: rows = [], isLoading } = useOnboardingReadiness(lookbackDays);

  const groups = useMemo(() => {
    const ready: ProviderReadiness[] = [];
    const issues: ProviderReadiness[] = [];
    for (const r of rows) {
      if (r.readyForSubmissions) ready.push(r);
      else issues.push(r);
    }
    return { ready, issues };
  }, [rows]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading onboarding readiness
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No providers added in the last {lookbackDays} days. Adjust the window above to
          look further back.
        </AlertDescription>
      </Alert>
    );
  }

  const renderTable = (subset: ProviderReadiness[], title: string, emptyText: string) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {title === 'Needs setup' ? (
            <AlertCircle className="h-4 w-4 text-amber-600" />
          ) : (
            <UserCheck className="h-4 w-4 text-emerald-600" />
          )}
          {title} ({subset.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {subset.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-6 pb-4">{emptyText}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Profession</TableHead>
                <TableHead className="text-center w-16">Email</TableHead>
                <TableHead className="text-center w-16">Active</TableHead>
                <TableHead className="text-center w-20">Profession</TableHead>
                <TableHead className="text-center w-20">Licenses</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Issues</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subset.map(r => (
                <TableRow key={r.provider_id}>
                  <TableCell>
                    <div className="font-medium">{r.provider_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.email ?? <span className="italic">no email</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.profession ?? <span className="italic text-muted-foreground">—</span>}
                    {r.isMentalHealth && (
                      <Badge className="ml-1 bg-purple-100 text-purple-800 hover:bg-purple-100 text-[10px]">
                        MH bypass
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <CheckCell ok={r.hasEmail} />
                  </TableCell>
                  <TableCell className="text-center">
                    <CheckCell ok={r.isActive} />
                  </TableCell>
                  <TableCell className="text-center">
                    <CheckCell ok={r.hasProfession} />
                  </TableCell>
                  <TableCell className="text-center">
                    {r.isMentalHealth ? (
                      <span className="text-xs text-muted-foreground italic">n/a</span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <CheckCell ok={r.hasLicensesIfNeeded} />
                        <span className="text-xs text-muted-foreground">{r.license_count}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateShort(r.created_at)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.issues.length > 0 ? (
                      <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
                        {r.issues.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-emerald-700">All prerequisites met</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-blue-600" />
                Onboarding readiness
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                For each provider added in the lookback window, this checks the three
                prerequisites for their Jotform submissions to flow through:
                Vitable email on file, <code>active = true</code>, profession set, and (for
                non-MH providers) at least one active license. Fix gaps here BEFORE the
                provider submits — otherwise the submission lands as unmatched or
                auto-declined.
              </p>
            </div>
            <Select
              value={String(lookbackDays)}
              onValueChange={v => setLookbackDays(Number(v))}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>
      {renderTable(groups.issues, 'Needs setup', 'Every recent provider is ready.')}
      {renderTable(groups.ready, 'Ready for submissions', 'No fully-ready recent providers.')}
    </div>
  );
}
