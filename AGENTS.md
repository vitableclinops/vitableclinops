
- Scheduling re-runs (evaluate/emit edge functions) skip months whose workflow stage is locked or published; override only with `force_locked=1`. Why: protects hand-edited, approved schedules from being overwritten.
- Oversupply trims in buildShiftRecommendationRows are week-balanced (cut from the fullest week, latest slot first within it); keep src/lib and _shared copies identical. Why: latest-first cutting emptied the end of the month for oversubmitted providers.
