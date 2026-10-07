
- Scheduling re-runs (evaluate/emit edge functions) skip months whose workflow stage is locked or published; override only with `force_locked=1`. Why: protects hand-edited, approved schedules from being overwritten.
