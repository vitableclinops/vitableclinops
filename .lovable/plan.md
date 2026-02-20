
## Bulk Complete All Active Tasks

### What This Does
Mark all 34 currently active (non-completed, non-archived) tasks as `completed` in one database operation. This gives you a clean task queue before initiating the new collaborative agreement work between South Denowitz and Kate Baron.

### What Will Be Updated
- **34 tasks** with status `pending`, `in_progress`, `blocked`, or `waiting_on_signature` will be set to `completed`
- Each task will get a `completed_at` timestamp of right now
- The task queue on the Admin Dashboard will show as empty / clean

### What Will NOT Be Affected
- The actual collaborative agreements themselves (those records are untouched)
- Any archived tasks (already archived tasks stay archived)
- Provider profiles, physician records, or agreement details

### Technical Details

**Single SQL data update (no schema changes needed):**
```sql
UPDATE public.agreement_tasks
SET
  status = 'completed',
  completed_at = now()
WHERE status NOT IN ('completed', 'archived');
```

This runs as a direct data update — no migration required, no code changes needed. The Admin Dashboard will reflect the empty queue immediately on next load or refresh.

### Sequence
1. Run the bulk-complete data update against `agreement_tasks`
2. Confirm the task queue is clear in the Admin Dashboard
3. You're ready to initiate the South Denowitz → Kate Baron collaborative agreement transfers

No UI or code changes are needed — this is purely a data operation.
