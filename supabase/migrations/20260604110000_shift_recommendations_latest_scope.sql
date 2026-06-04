-- Keep shift_recommendations aligned with the current provider/month submission.
-- The dashboard and publish flow summarize this table directly; stale rows from
-- superseded or older resubmissions can otherwise inflate accepted coverage.

delete from public.shift_recommendations sr
using public.schedule_submissions ss
where sr.submission_id = ss.id
  and ss.decision_status = 'superseded';

with latest_submissions as (
  select
    ss.id,
    ss.provider_id,
    ss.target_month,
    ss.decision_status,
    row_number() over (
      partition by ss.provider_id, ss.target_month
      order by ss.submitted_at desc nulls last, ss.id desc
    ) as rn
  from public.schedule_submissions ss
  where ss.provider_id is not null
    and ss.decision_status is distinct from 'superseded'
),
current_submissions as (
  select *
  from latest_submissions
  where rn = 1
)
delete from public.shift_recommendations sr
using public.schedule_submissions ss
join current_submissions latest
  on latest.provider_id = ss.provider_id
 and latest.target_month = ss.target_month
where sr.submission_id = ss.id
  and ss.id <> latest.id;

delete from public.shift_recommendations sr
using public.schedule_submissions ss
where sr.submission_id = ss.id
  and sr.recommendation = 'publish'
  and coalesce(ss.decision_status, '') not in ('accepted', 'partial');

with ranked_rows as (
  select
    sr.id,
    row_number() over (
      partition by sr.submission_id, sr.shift_date, sr.start_min, sr.end_min, sr.shift_type
      order by
        case sr.publish_status
          when 'confirmed' then 1
          when 'published_to_homebase' then 2
          when 'pending' then 3
          else 4
        end,
        sr.updated_at desc nulls last,
        sr.created_at desc nulls last,
        sr.id desc
    ) as rn
  from public.shift_recommendations sr
)
delete from public.shift_recommendations sr
using ranked_rows ranked
where sr.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists shift_recommendations_submission_shift_key_idx
  on public.shift_recommendations (submission_id, shift_date, start_min, end_min, shift_type);
