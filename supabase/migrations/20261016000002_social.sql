-- Social layer: profiles, daily results, follows, reactions.
-- Scores are computed server-side from the day's targets (see 0001).

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

create table public.results (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  day int not null,
  actuals numeric(7, 3)[] not null
    check (array_ndims(actuals) = 1 and array_lower(actuals, 1) = 1 and array_length(actuals, 1) = 5),
  score int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
create index results_day_score on public.results (day, score desc);

create table public.follows (
  follower uuid not null default auth.uid() references public.profiles on delete cascade,
  followee uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index follows_followee on public.follows (followee);

create table public.reactions (
  result_id bigint not null references public.results on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  emoji text not null check (emoji in ('🔥', '🎯', '😂', '🫠', '⚡')),
  created_at timestamptz not null default now(),
  primary key (result_id, user_id, emoji)
);

-- Validate a submission and compute its score. Clients cannot set score.
create or replace function public.ic_results_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Players are in different time zones: allow the UTC day ±1.
  if abs(new.day - public.ic_utc_day()) > 1 then
    raise exception 'day % is not playable now', new.day;
  end if;
  if exists (select 1 from unnest(new.actuals) a where a is null or a <= 0 or a > 60) then
    raise exception 'invalid hold durations';
  end if;
  new.user_id := auth.uid();
  new.score := public.ic_score(new.day, new.actuals);
  new.created_at := now();
  return new;
end;
$$;

create trigger results_before_insert
before insert on public.results
for each row execute function public.ic_results_before_insert();

-- Security definer to avoid RLS recursion on results.
create or replace function public.ic_has_played(p_day int)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.results where user_id = auth.uid() and day = p_day);
$$;

alter table public.profiles enable row level security;
alter table public.results enable row level security;
alter table public.follows enable row level security;
alter table public.reactions enable row level security;

create policy "profiles are public" on public.profiles for select using (true);
create policy "create own profile" on public.profiles for insert with check (id = auth.uid());
-- No renames: challenge links (?vs=username) must keep pointing at the same person.

-- No spoilers: today's results are visible only after you've played today.
create policy "results visible after playing" on public.results for select using (
  user_id = auth.uid()
  or public.ic_has_played(day)
  or day < public.ic_utc_day() - 1
);
create policy "submit own result" on public.results for insert with check (user_id = auth.uid());

create policy "follows are public" on public.follows for select using (true);
create policy "follow as self" on public.follows for insert with check (follower = auth.uid());
create policy "unfollow as self" on public.follows for delete using (follower = auth.uid());

-- Only reactions on results you can see (no hints about today's hidden scores).
create policy "reactions visible with result" on public.reactions for select using (
  exists (select 1 from public.results r where r.id = result_id)
);
-- The subquery runs under results RLS, so you can only react to results you can see.
create policy "react as self" on public.reactions for insert with check (
  user_id = auth.uid() and exists (select 1 from public.results r where r.id = result_id)
);
create policy "unreact as self" on public.reactions for delete using (user_id = auth.uid());

-- Leaderboard for a day, global or friends-only (people you follow + you).
-- Security invoker: results RLS hides today's board until you've played.
create or replace function public.leaderboard(p_day int, p_friends boolean default false, p_limit int default 50)
returns table (
  result_id bigint,
  user_id uuid,
  username text,
  score int,
  actuals numeric[],
  created_at timestamptz,
  reactions jsonb,
  my_reactions text[]
)
language sql stable
set search_path = ''
as $$
  select r.id, r.user_id, p.username, r.score, r.actuals, r.created_at,
    coalesce((
      select jsonb_object_agg(x.emoji, x.n)
      from (select emoji, count(*) n from public.reactions where result_id = r.id group by emoji) x
    ), '{}'::jsonb),
    coalesce((
      select array_agg(emoji) from public.reactions where result_id = r.id and user_id = auth.uid()
    ), '{}')
  from public.results r
  join public.profiles p on p.id = r.user_id
  where r.day = p_day
    and (
      not p_friends
      or r.user_id = auth.uid()
      or exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = r.user_id)
    )
  order by r.score desc, r.created_at asc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Your global rank for a day. Empty until you've played (no spoilers).
create or replace function public.my_rank(p_day int)
returns table (rank bigint, total bigint)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select score, created_at from public.results where user_id = auth.uid() and day = p_day
  )
  select
    (select count(*) + 1 from public.results r
      where r.day = p_day and (r.score > me.score or (r.score = me.score and r.created_at < me.created_at))),
    (select count(*) from public.results where day = p_day)
  from me;
$$;

-- Public counter for the home screen ("1,234 people played today").
create or replace function public.players_today(p_day int)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*) from public.results where day = p_day;
$$;

-- Aggregate stats for a profile. Ignores scores the caller isn't allowed to see yet.
create or replace function public.profile_stats(p_username text)
returns table (
  user_id uuid,
  username text,
  played bigint,
  best int,
  avg_score numeric,
  streak bigint,
  followers bigint,
  following bigint
)
language sql stable security definer set search_path = ''
as $$
  with p as (select id, username from public.profiles where username = lower(p_username)),
  visible as (
    select r.day, r.score from public.results r, p
    where r.user_id = p.id
      and (r.day < public.ic_utc_day() - 1 or p.id = auth.uid() or public.ic_has_played(r.day))
  ),
  days as (
    select day, day + row_number() over (order by day desc) as grp from visible
  ),
  run as (
    select count(*) as n, max(day) as last_day
    from days where grp = (select grp from days order by day desc limit 1)
  )
  select p.id, p.username,
    (select count(*) from visible),
    (select max(score) from visible),
    (select round(avg(score), 1) from visible),
    case when (select last_day from run) >= public.ic_utc_day() - 2 then (select n from run) else 0 end,
    (select count(*) from public.follows where followee = p.id),
    (select count(*) from public.follows where follower = p.id)
  from p;
$$;

-- Defense in depth: results are immutable; signed-out visitors get nothing.
revoke update, delete, truncate on public.results from anon, authenticated;
revoke update, truncate on public.reactions, public.follows from anon, authenticated;
revoke update, truncate on public.profiles from anon, authenticated;
revoke all on public.profiles, public.results, public.follows, public.reactions from anon;
revoke execute on function
  public.leaderboard(int, boolean, int), public.my_rank(int), public.players_today(int),
  public.profile_stats(text), public.ic_has_played(int)
from public, anon;
grant execute on function
  public.leaderboard(int, boolean, int), public.my_rank(int), public.players_today(int),
  public.profile_stats(text), public.ic_has_played(int)
to authenticated;

-- Live leaderboard updates (realtime still respects RLS).
alter publication supabase_realtime add table public.results, public.reactions;
