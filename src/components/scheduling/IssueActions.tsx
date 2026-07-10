import { useMemo, useState } from 'react';
import { ExternalLink, Link2, Check, X, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from '@/components/ui/command';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  useApplyReconciliationOverride,
  useRemoveReconciliationOverride,
  useLinkHomebaseEmployee,
  useProviderProfilesForLink,
  type ReconciliationOverrideRow,
  type ReconciliationResolution,
} from '@/hooks/useReconciliationOverrides';

const HOMEBASE_SCHEDULER_URL = 'https://app.joinhomebase.com/schedule_builder';

export interface IssueActionContext {
  issueKey: string;
  issueType:
    | 'missing_homebase'
    | 'time_mismatch'
    | 'homebase_unpublished'
    | 'homebase_unscheduled'
    | 'extra_homebase'
    | 'unmatched_homebase_employee';
  dateKey: string;
  providerId: string | null;
  providerName: string;
  approvedShiftId: string | null;
  homebaseShiftId: string | null;
  override: ReconciliationOverrideRow | null;
  onResync?: () => void;
  isResyncing?: boolean;
}

const resolutionLabel: Record<ReconciliationResolution, string> = {
  ignored: 'Ignored',
  accept_homebase: 'Accepted Homebase time',
  accept_lovable: 'Awaiting Homebase update',
  acknowledged: 'Acknowledged',
  pending_admin_approval: 'Pending admin approval',
  mapped_employee: 'Employee linked',
};

export const IssueActions = (props: IssueActionContext) => {
  const { toast } = useToast();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const isPodLead = hasRole('pod_lead');
  const canAct = isAdmin || isPodLead;

  const apply = useApplyReconciliationOverride();
  const remove = useRemoveReconciliationOverride();
  const linkEmployee = useLinkHomebaseEmployee();

  const [confirm, setConfirm] = useState<{
    resolution: ReconciliationResolution;
    title: string;
    description: string;
  } | null>(null);
  const [note, setNote] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);

  const closeConfirm = () => {
    setConfirm(null);
    setNote('');
  };

  const runOverride = async (resolution: ReconciliationResolution, noteText?: string) => {
    try {
      await apply.mutateAsync({
        issue_key: props.issueKey,
        issue_type: props.issueType,
        resolution,
        note: noteText ?? null,
        date_key: props.dateKey,
        provider_id: props.providerId,
        approved_shift_id: props.approvedShiftId,
        homebase_shift_id: props.homebaseShiftId,
      });
      toast({ title: 'Saved', description: resolutionLabel[resolution] });
      closeConfirm();
    } catch (err) {
      toast({
        title: 'Could not save',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const undo = async () => {
    try {
      await remove.mutateAsync(props.issueKey);
      toast({ title: 'Resolution removed' });
    } catch (err) {
      toast({
        title: 'Could not undo',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (props.override) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed pt-2">
        <Badge variant="outline" className="bg-emerald-50 text-emerald-900 border-emerald-300">
          <Check className="mr-1 h-3 w-3" />
          {resolutionLabel[props.override.resolution]}
        </Badge>
        {props.override.note && (
          <span className="text-xs italic text-muted-foreground">"{props.override.note}"</span>
        )}
        {canAct && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={undo}
            disabled={remove.isPending}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Undo
          </Button>
        )}
      </div>
    );
  }

  if (!canAct) {
    return null;
  }

  const buttons: JSX.Element[] = [];
  const homebaseLink = (
    <Button
      key="open-homebase"
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      asChild
    >
      <a href={HOMEBASE_SCHEDULER_URL} target="_blank" rel="noreferrer">
        <ExternalLink className="mr-1 h-3 w-3" />
        Open Homebase
      </a>
    </Button>
  );
  const resync = props.onResync && (
    <Button
      key="resync"
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={props.onResync}
      disabled={props.isResyncing}
    >
      {props.isResyncing ? (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      ) : (
        <RotateCcw className="mr-1 h-3 w-3" />
      )}
      Re-sync
    </Button>
  );

  switch (props.issueType) {
    case 'missing_homebase':
      buttons.push(homebaseLink);
      if (resync) buttons.push(resync);
      buttons.push(
        <Button
          key="ignore"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() =>
            setConfirm({
              resolution: 'ignored',
              title: 'Ignore this missing shift?',
              description: `Hides this issue for ${props.providerName} on ${props.dateKey}. You can undo later.`,
            })
          }
        >
          <X className="mr-1 h-3 w-3" /> Ignore
        </Button>,
      );
      break;
    case 'unmatched_homebase_employee':
      buttons.push(
        <Button
          key="link"
          size="sm"
          variant="default"
          className="h-7 px-2 text-xs"
          onClick={() => setLinkOpen(true)}
        >
          <Link2 className="mr-1 h-3 w-3" /> Link to provider…
        </Button>,
      );
      if (resync) buttons.push(resync);
      buttons.push(
        <Button
          key="ignore"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() =>
            setConfirm({
              resolution: 'ignored',
              title: 'Ignore this unmatched employee?',
              description: 'You can link them later from the Provider Directory.',
            })
          }
        >
          <X className="mr-1 h-3 w-3" /> Ignore
        </Button>,
      );
      break;
    case 'extra_homebase':
      buttons.push(homebaseLink);
      if (isAdmin) {
        buttons.push(
          <Button
            key="accept"
            size="sm"
            variant="default"
            className="h-7 px-2 text-xs"
            onClick={() =>
              setConfirm({
                resolution: 'accept_homebase',
                title: 'Accept this Homebase shift?',
                description: 'Overrides the missing approval. The Homebase shift will be treated as the source of truth for this day.',
              })
            }
          >
            <Check className="mr-1 h-3 w-3" /> Accept into Lovable
          </Button>,
        );
      }
      buttons.push(
        <Button
          key="request"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() =>
            setConfirm({
              resolution: 'pending_admin_approval',
              title: 'Request admin approval?',
              description: 'Flags this shift for an admin to approve or remove. You can add context below.',
            })
          }
        >
          <AlertCircle className="mr-1 h-3 w-3" /> Request approval
        </Button>,
      );
      buttons.push(
        <Button
          key="ignore"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() =>
            setConfirm({
              resolution: 'ignored',
              title: 'Ignore this extra Homebase shift?',
              description: 'Hides this issue. Remove the shift in Homebase if it shouldn’t be there.',
            })
          }
        >
          <X className="mr-1 h-3 w-3" /> Ignore
        </Button>,
      );
      break;
    case 'time_mismatch':
      buttons.push(homebaseLink);
      if (isAdmin) {
        buttons.push(
          <Button
            key="accept-hb"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() =>
              setConfirm({
                resolution: 'accept_homebase',
                title: 'Accept Homebase time?',
                description: 'Records that the Homebase time is correct. The day will no longer be flagged.',
              })
            }
          >
            Accept Homebase time
          </Button>,
        );
        buttons.push(
          <Button
            key="accept-lov"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() =>
              setConfirm({
                resolution: 'accept_lovable',
                title: 'Accept Lovable time?',
                description: 'Records that the Lovable approved time is correct. Update Homebase to match.',
              })
            }
          >
            Accept Lovable time
          </Button>,
        );
      }
      buttons.push(
        <Button
          key="ack"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() =>
            setConfirm({
              resolution: 'acknowledged',
              title: 'Acknowledge mismatch?',
              description: 'Snoozes this issue until the next sync.',
            })
          }
        >
          Acknowledge
        </Button>,
      );
      break;
    case 'homebase_unpublished':
    case 'homebase_unscheduled':
      // Publishing actually happens in Homebase, so make that the primary
      // action; "Snooze" only hides the flag until the next sync.
      buttons.push(
        <Button
          key="open-homebase-primary"
          size="sm"
          className="h-7 px-2 text-xs"
          asChild
        >
          <a href={HOMEBASE_SCHEDULER_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1 h-3 w-3" />
            Open Homebase
          </a>
        </Button>,
      );
      buttons.push(
        <Button
          key="ack"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() =>
            setConfirm({
              resolution: 'acknowledged',
              title: 'Snooze until next sync?',
              description:
                'This only hides the flag until the next Homebase sync — it does not publish the shift. To publish, use "Open Homebase" and publish it there.',
            })
          }
        >
          Snooze until next sync
        </Button>,
      );
      break;
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed pt-2">
        {buttons}
      </div>

      <Dialog open={!!confirm} onOpenChange={(open) => !open && closeConfirm()}>
        <DialogContent className="max-w-md">
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>{confirm.title}</DialogTitle>
                <DialogDescription>{confirm.description}</DialogDescription>
              </DialogHeader>
              <Textarea
                placeholder="Optional note for the audit trail…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
              <DialogFooter>
                <Button variant="ghost" onClick={closeConfirm} disabled={apply.isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={() => runOverride(confirm.resolution, note.trim() || undefined)}
                  disabled={apply.isPending}
                >
                  {apply.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Confirm
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <LinkProviderDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        homebaseName={props.providerName}
        onLinked={async (profileId) => {
          try {
            await linkEmployee.mutateAsync({ homebase_name: props.providerName, profile_id: profileId });
            await apply.mutateAsync({
              issue_key: props.issueKey,
              issue_type: props.issueType,
              resolution: 'mapped_employee',
              date_key: props.dateKey,
              provider_id: profileId,
              approved_shift_id: props.approvedShiftId,
              homebase_shift_id: props.homebaseShiftId,
              note: `Mapped "${props.providerName}" → provider`,
            });
            toast({
              title: 'Mapping saved',
              description: 'Click "Sync Homebase" to refresh the match for future shifts.',
            });
            setLinkOpen(false);
          } catch (err) {
            toast({
              title: 'Could not save mapping',
              description: err instanceof Error ? err.message : 'Unknown error',
              variant: 'destructive',
            });
          }
        }}
        isSaving={linkEmployee.isPending || apply.isPending}
      />
    </>
  );
};

interface LinkProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homebaseName: string;
  onLinked: (profileId: string) => void;
  isSaving: boolean;
}

const LinkProviderDialog = ({
  open, onOpenChange, homebaseName, onLinked, isSaving,
}: LinkProviderDialogProps) => {
  const { data: profiles = [], isLoading } = useProviderProfilesForLink();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = profiles as Array<{ id: string; full_name: string | null; email: string | null; credentials: string | null }>;
    if (!q) return list.slice(0, 50);
    return list
      .filter(p =>
        (p.full_name ?? '').toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [profiles, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link "{homebaseName}" to a provider</DialogTitle>
          <DialogDescription>
            Future Homebase syncs will match shifts with this Homebase name to the selected provider.
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="rounded-md border">
          <CommandInput
            placeholder="Search by name or email…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-72">
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : (
              <>
                <CommandEmpty>No providers found.</CommandEmpty>
                <CommandGroup>
                  {filtered.map(p => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => !isSaving && onLinked(p.id)}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="font-medium">
                        {p.full_name ?? '—'}{p.credentials ? <span className="text-muted-foreground"> · {p.credentials}</span> : null}
                      </span>
                      {p.email && (
                        <span className="text-xs text-muted-foreground">{p.email}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
        {isSaving && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving mapping…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};