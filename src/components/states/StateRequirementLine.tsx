import { Fragment } from 'react';
import { stateRequirementSummary } from '@/lib/stateRequirementSummary';

export function StateRequirementLine({ state, collabType, caRequired }: { state: string; collabType?: string | null; caRequired?: boolean | null }) {
  const parts = stateRequirementSummary(state, collabType, caRequired).split(' OR ');
  return (
    <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-1">
      <p className="font-semibold">Requirements:</p>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <p className="text-xs font-bold text-muted-foreground">OR</p>}
          <p>{p}</p>
        </Fragment>
      ))}
    </div>
  );
}
