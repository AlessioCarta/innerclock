-- Privacy-friendly analytics: anonymous event counters, no user id, no IP.
-- Clients can only insert; read the views from the Supabase dashboard (SQL editor).

create table public.events (
  id bigint generated always as identity primary key,
  day int not null,
  kind text not null check (kind in ('visit', 'play', 'finish', 'share', 'challenge', 'vs_visit', 'vs_finish')),
  created_at timestamptz not null default now()
);
create index events_day_kind on public.events (day, kind);

alter table public.events enable row level security;
create policy "log events" on public.events for insert to authenticated
  with check (abs(day - public.ic_utc_day()) <= 1);

revoke all on public.events from anon;
revoke select, update, delete, truncate on public.events from authenticated;

-- One row per day. Counts are per device per day (the client dedupes).
create view public.stats_daily with (security_invoker = true) as
select
  day,
  count(*) filter (where kind = 'visit') as visitors,
  count(*) filter (where kind = 'play') as started,
  count(*) filter (where kind = 'finish') as finished,
  count(*) filter (where kind = 'share') as shared,
  count(*) filter (where kind = 'challenge') as challenges_sent,
  count(*) filter (where kind = 'vs_visit') as challenge_visits,
  count(*) filter (where kind = 'vs_finish') as challenge_finishes,
  round(100.0 * count(*) filter (where kind = 'finish') / nullif(count(*) filter (where kind = 'visit'), 0), 1) as finish_rate_pct,
  round(100.0 * count(*) filter (where kind in ('share', 'challenge')) / nullif(count(*) filter (where kind = 'finish'), 0), 1) as share_rate_pct,
  round(100.0 * count(*) filter (where kind = 'vs_finish') / nullif(count(*) filter (where kind = 'vs_visit'), 0), 1) as challenge_conversion_pct
from public.events
group by day
order by day desc;

-- Return rate by first-play day, from players who posted a score.
create view public.stats_retention with (security_invoker = true) as
with firsts as (
  select user_id, min(day) as first_day from public.results group by user_id
)
select
  f.first_day as cohort_day,
  count(*) as new_players,
  count(*) filter (where exists (
    select 1 from public.results r where r.user_id = f.user_id and r.day = f.first_day + 1
  )) as returned_next_day,
  count(*) filter (where exists (
    select 1 from public.results r where r.user_id = f.user_id and r.day between f.first_day + 1 and f.first_day + 7
  )) as returned_within_7_days
from firsts f
group by f.first_day
order by f.first_day desc;

revoke all on public.stats_daily, public.stats_retention from anon, authenticated;
