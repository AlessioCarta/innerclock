-- Pure game functions. Mirrors src/core.js (targetsFor / roundScore).
-- No dependency on Supabase schemas, so tests can load it into plain Postgres.

-- Day #1 = 2026-10-16 (UTC).
create or replace function public.ic_utc_day()
returns int
language sql stable
set search_path = ''
as $$
  select ((now() at time zone 'utc')::date - date '2026-10-16') + 1;
$$;

-- Five targets in seconds, identical to targetsFor() in src/core.js.
create or replace function public.ic_targets(p_day int)
returns numeric[]
language sql immutable
set search_path = ''
as $$
  select array_agg(t order by i)
  from (
    select b.i,
      (b.lo + ((
          get_byte(hash.h, 0)::bigint * 16777216
        + get_byte(hash.h, 1)::bigint * 65536
        + get_byte(hash.h, 2)::bigint * 256
        + get_byte(hash.h, 3)::bigint
      ) * (b.hi - b.lo + 1)) / 4294967296)::numeric / 10 as t
    from (values (0, 10, 30), (1, 25, 50), (2, 40, 70), (3, 60, 100), (4, 80, 150)) as b(i, lo, hi),
    lateral (select sha256(convert_to('innerclock:' || p_day || ':' || b.i, 'UTF8')) as h) as hash
  ) s;
$$;

-- 0–100 points for one round; 25%+ off = 0. Mirrors roundScore():
-- round(100 - 400·|a−t|/t) in integer milliseconds.
create or replace function public.ic_round_score(p_target numeric, p_actual numeric)
returns int
language sql immutable
set search_path = ''
as $$
  select greatest(0, floor((201 * t - 800 * abs(a - t))::numeric / (2 * t)))::int
  from (select round(p_target * 1000)::bigint as t, round(p_actual * 1000)::bigint as a) ms;
$$;

create or replace function public.ic_score(p_day int, p_actuals numeric[])
returns int
language sql immutable
set search_path = ''
as $$
  select coalesce(sum(public.ic_round_score(t.target, p_actuals[t.i])), 0)::int
  from unnest(public.ic_targets(p_day)) with ordinality as t(target, i);
$$;
