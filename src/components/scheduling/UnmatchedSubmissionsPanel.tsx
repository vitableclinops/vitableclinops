import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertCircle, Link as LinkIcon, Loader2, Search, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  useDismissUnmatchedSubmission,
  useLinkUnmatchedSubmission,
  useProviderSearch,
  useUnmatchedSubmissions,
  type ProviderSearchHit,
  type UnmatchedSubmission,
} from '@/hooks/useMonthlyPublish';

const formatMonthShort = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) return iso;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const formatRelative = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

const emailFromSubmission = (s: UnmatchedSubmission): string | null => {
  const parsed = s.parsed_shifts;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const blob = parsed as Record<string, unknown>;
    if (typeof blob.email === 'string' && blob.email.trim()) return blob.email.trim();
  }
  const raw = s.raw_answers;
  if (raw && typeof raw === 'object') {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      if (v && typeof v === 'object' && 'name' in v && (v as Record<string, unknown>).name === 'email') {
        const ans = (v as Record<string, unknown>).answer;
        if (typeof ans === 'string' && ans.includes('@')) return ans.trim();
      }
    }
  }
  return null;
};

export function UnmatchedSubmissionsPanel() {
  const { data: rows = [], isLoading } = useUnmatchedSubmissions();
  const [linkTarget, setLinkTarget] = useState<UnmatchedSubmission | null>(null);
  const [dismissTarget, setDismissTarget] = useState<UnmatchedSubmission | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading unmatched submissions
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No unmatched Jotform submissions. Every recent submission either matched a
          provider on file or has already been dismissed.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            Unmatched Jotform submissions ({rows.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            These submissions landed in the database but couldn't be matched to a provider
            via email or fuzzy name match. They're invisible to the evaluator and Workbench
            until you link them. Most common cause: the provider wasn't in the{' '}
            <code>providers</code> table yet when they submitted. Link to the right
            provider (and we'll re-evaluate that month immediately), or dismiss if it was a
            test / spam.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Submission name / email</TableHead>
                <TableHead>For month</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const email = emailFromSubmission(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.provider_name || '(no name)'}</div>
                      <div className="text-xs text-muted-foreground">
                        {email ?? <span className="italic">no email in submission</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-blue-50 border-blue-200 text-blue-900">
                        {formatMonthShort(r.target_month)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{formatRelative(r.submitted_at)}</div>
                      <div className="text-[10px] opacity-70">
                        {new Date(r.submitted_at).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => setLinkTarget(r)}
                        >
                          <LinkIcon className="h-3 w-3 mr-1" />
                          Link
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-red-700"
                          onClick={() => setDismissTarget(r)}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Dismiss
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {linkTarget && (
        <LinkDialog submission={linkTarget} onClose={() => setLinkTarget(null)} />
      )}
      {dismissTarget && (
        <DismissDialog submission={dismissTarget} onClose={() => setDismissTarget(null)} />
      )}
    </>
  );
}

function LinkDialog({
  submission,
  onClose,
}: {
  submission: UnmatchedSubmission;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(submission.provider_name || '');
  const [selected, setSelected] = useState<ProviderSearchHit | null>(null);
  const { data: matches = [], isFetching } = useProviderSearch(query);
  const link = useLinkUnmatchedSubmission();

  const email = useMemo(() => emailFromSubmission(submission), [submission]);

  const handle = () => {
    if (!selected) return;
    link.mutate(
      {
        submission_id: submission.id,
        provider_id: selected.id,
        provider_name: selected.name,
        target_month: submission.target_month,
      },
      {
        onSuccess: () => {
          toast.success(
            `Linked to ${selected.name} · re-evaluating ${formatMonthShort(submission.target_month)}`,
          );
          onClose();
        },
        onError: e => toast.error(`Link failed: ${(e as Error).message}`),
      },
    );
  };

  return (
    <Dialog open={true} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-blue-600" />
            Link unmatched submission
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{submission.provider_name || '(no name)'}</span>
            {email && <> · {email}</>} · submitted for {formatMonthShort(submission.target_month)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search providers by name or email"
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="max-h-72 overflow-y-auto border rounded-md">
            {query.trim().length < 2 ? (
              <p className="text-xs text-muted-foreground italic px-3 py-3">
                Type at least 2 characters to search.
              </p>
            ) : isFetching ? (
              <p className="text-xs text-muted-foreground italic px-3 py-3">Searching…</p>
            ) : matches.length === 0 ? (
              <p className="text-xs text-muted-foreground italic px-3 py-3">
                No providers found. They may not be onboarded yet — check the Setup tab.
              </p>
            ) : (
              <ul className="divide-y">
                {matches.map(p => (
                  <li
                    key={p.id}
                    className={`px-3 py-2 cursor-pointer hover:bg-muted ${
                      selected?.id === p.id ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => setSelected(p)}
                  >
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.email ?? <span className="italic">no email</span>}
                      {p.profession && <> · {p.profession}</>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={link.isPending}>
            Cancel
          </Button>
          <Button onClick={handle} disabled={!selected || link.isPending}>
            {link.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <LinkIcon className="h-4 w-4 mr-1" />
            )}
            Link & re-evaluate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DismissDialog({
  submission,
  onClose,
}: {
  submission: UnmatchedSubmission;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const dismiss = useDismissUnmatchedSubmission();

  const handle = () => {
    dismiss.mutate(
      { submission_id: submission.id, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast.success('Submission dismissed');
          onClose();
        },
        onError: e => toast.error(`Dismiss failed: ${(e as Error).message}`),
      },
    );
  };

  return (
    <Dialog open={true} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss as unmatched?</DialogTitle>
          <DialogDescription>
            This marks the submission <code>superseded</code> with an audit note. The data
            stays in the database but won't appear in the unmatched inbox again. Use this
            for test submissions or spam — for real providers, link them instead.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Optional: reason (e.g. 'Test submission from QA', 'Provider already submitted via different email')"
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={dismiss.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handle} disabled={dismiss.isPending}>
            {dismiss.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-1" />
            )}
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
