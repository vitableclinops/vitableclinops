# Same-Day / Next-Day Agent — foundations

This directory holds the freshness layer for the same-day / next-day
coverage agent. It records the measurements the constants in
`freshness.ts` are derived from, so they can be re-checked rather than
trusted.

All queries run against the Vitable Postgres warehouse (Metabase database
`3`). Results below are from **2026-09-15**.

---

## 1. The warehouse sync runs every 6 hours, not ~5

```sql
with batches as (
  select distinct date_trunc('second', _fivetran_synced) as synced_at
  from ac.ac_asclepius__appointment_appointment
  where _fivetran_synced > now() - interval '10 days'
),
gaps as (
  select synced_at, lag(synced_at) over (order by synced_at) as prev_synced_at
  from batches
)
select to_char(synced_at, 'YYYY-MM-DD HH24:MI') as sync_batch_et,
       round(extract(epoch from (synced_at - prev_synced_at))/3600.0, 2) as hours_since_prev
from gaps
order by synced_at desc;
```

Batches land at roughly **02:02, 08:02, 14:02 and 20:02 ET**. Across the
trailing 10 days the gap was 6.00h in 20 of 25 intervals. The exceptions
matter: a **12.0h** gap on 09-08 and a **29.4h** gap on 09-10, both
consistent with a missed or failed batch.

So the lag at a random moment averages ~3h, reaches 6h just before a
sync, and can blow well past that without warning. That last case is why
`classifyFreshness` reports `stale` past one cycle instead of assuming the
schedule held.

## 2. Reading the raw landing zone does not help

The obvious fix — point real-time reads at `ac.ac_asclepius__appointment_appointment`
instead of `dbt_production.int_availability_appointments_provider` —
**buys nothing**.

```sql
with raw as (
  select max(_fivetran_synced) as last_sync, max(created) as last_created
  from ac.ac_asclepius__appointment_appointment
  where coalesce(_fivetran_deleted, false) = false
),
dbtp as (
  select max(appointment_created_at) as last_appt_created
  from dbt_production.int_availability_appointments_provider
)
select raw.last_created, dbtp.last_appt_created,
       round(extract(epoch from (raw.last_created - dbtp.last_appt_created))/60.0, 1)
         as raw_ahead_of_dbt_min,
       (select count(*) from ac.ac_asclepius__appointment_appointment r
          where coalesce(r._fivetran_deleted, false) = false
            and r.created > dbtp.last_appt_created) as bookings_raw_has_dbt_missing
from raw, dbtp;
```

Result: `raw_ahead_of_dbt_min = 0` and `bookings_raw_has_dbt_missing = 0`.
The newest booking timestamp is **identical** in both, and the raw table
holds zero bookings the dbt table lacks.

The lag is in the **source → warehouse** hop (Fivetran), not in the dbt
transformation. Both tables sit downstream of the same batch. Only raising
the sync frequency, or reading the EHR directly, changes the freshness
picture.

## 3. The blind spot is bounded, and smaller than expected

How many same/next-day bookings actually land during the hours a stale
reading cannot see:

```sql
with cal as (
  select count(*) as business_hours
  from generate_series(current_date - 30, current_date - 1, interval '1 day') d
  cross join generate_series(8, 19) h
  where extract(dow from d) between 1 and 5
),
booked as (
  select a.appointment_state as state, count(*) as bookings
  from dbt_production.fct_appointments a
  where a.appointment_status in ('Charted','Chart Pending')
    and a.appointment_state is not null
    and a.appointment_created_at_est >= current_date - 30
    and a.appointment_created_at_est <  current_date
    and (a.appointment_date_est - a.appointment_created_at_est::date) <= 1
    and extract(hour from a.appointment_created_at_est) between 8 and 19
    and extract(dow from a.appointment_created_at_est) between 1 and 5
  group by 1
)
select b.state, b.bookings as sd_nd_bookings_30d,
       round(b.bookings::numeric / cal.business_hours, 3) as bookings_per_business_hour,
       round(b.bookings::numeric / cal.business_hours * 6, 1) as expected_missed_per_6h_sync
from booked b cross join cal
order by b.bookings desc;
```

| State | SD/ND bookings (30d) | Per business hour | Missed per 6h cycle | Missed at avg ~3h lag |
|---|---|---|---|---|
| PA | 332 | 1.317 | 7.9 | 4.0 |
| TX | 103 | 0.409 | 2.5 | 1.2 |
| FL | 95 | 0.377 | 2.3 | 1.1 |
| NJ | 90 | 0.357 | 2.1 | 1.1 |
| DE | 59 | 0.234 | 1.4 | 0.7 |
| OH | 51 | 0.202 | 1.2 | 0.6 |
| WA | 32 | 0.127 | 0.8 | 0.4 |
| MD | 31 | 0.123 | 0.7 | 0.4 |
| VA | 31 | 0.123 | 0.7 | 0.4 |
| IL | 16 | 0.063 | 0.4 | 0.2 |

**Divide by all business hours, not just hours that had a booking.** The
naive version — `avg(count)` grouped by hour — is conditioned on a booking
having occurred and badly overstates low-volume states. It put MN at 6.6
missed bookings per cycle; the correct figure is **0.5**.

### What this implies

At the average ~3h lag, an open-slot count is overstated by about **4
slots in PA** and by **1 or fewer in every other state**. Against PA's p90
same/next-day demand of 31 (Metabase question 3951) that is a real but
modest error; against the flat policy floor of 5 it would dominate.

So staleness is worth **correcting for**, not blocking on.
`adjustOpenSlotsForStaleness` subtracts the expected bookings-since-sync,
rounds up, and floors at zero, so the correction is deliberately
pessimistic.

It models **bookings only**. Cancellations since the sync free slots back
up and are not modelled, so `adjustedOpen` is a lower bound: the true
value lies between `adjustedOpen` and `reportedOpen`.

---

## Still blocked on engineering

Two questions the warehouse cannot answer, both from the data-inventory
review:

1. **Booking cutoff.** Whether a slot 20 minutes out is *actually
   bookable* is an application rule — lead-time minimums, prep buffers,
   cancellation windows — and none of it is in the warehouse. Until
   engineering confirms the rule, "slots still in the future" cannot be
   taken to mean "slots a member can book". The freshness layer here does
   not assume otherwise; it only corrects for bookings already made.

2. **Request-attempt logging.** Demand is censored: only *booked* visits
   are observable. A member who wanted today and found nothing is
   invisible, so every threshold derived from history is a floor biased
   low, and an agent built on it will systematically under-alert. Closing
   this needs logging on the scheduling flow.

## Refreshing these constants

The booking rates are a snapshot. Re-run query 3 and update
`SD_ND_BOOKINGS_PER_BUSINESS_HOUR` in `freshness.ts` when state volumes
shift materially — after a state launch, a large employer going live, or a
change to the SLA tiers.
