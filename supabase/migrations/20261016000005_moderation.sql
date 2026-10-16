-- Moderation for user-generated content (App Store guideline 1.2):
-- username filter, report a player, block a player.

-- Usernames: reject common profanity/slurs (EN + IT) and reserved names.
create or replace function public.ic_username_allowed(p_username text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_username !~ '(fuck|shit|cunt|nigg|fag|rape|nazi|hitler|porn|dick|pussy|whore|slut|bitch|cazz|merda|troia|puttan|vaffancul|stronz|frocio|coglion|negr)'
     and p_username !~ '^(admin|administrator|moderator|mod|support|staff|innerclock|official|apple|root)$';
$$;

alter table public.profiles
  add constraint username_allowed check (public.ic_username_allowed(username));

create table public.blocks (
  blocker uuid not null default auth.uid() references public.profiles on delete cascade,
  blocked uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

create table public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references public.profiles on delete cascade,
  reported uuid not null references public.profiles on delete cascade,
  reason text not null default 'other' check (length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index reports_reported on public.reports (reported);

alter table public.blocks enable row level security;
alter table public.reports enable row level security;

create policy "see own blocks" on public.blocks for select using (blocker = auth.uid());
create policy "block as self" on public.blocks for insert with check (blocker = auth.uid());
create policy "unblock as self" on public.blocks for delete using (blocker = auth.uid());

-- Reports are write-only for players; review them in the Supabase dashboard.
create policy "report as self" on public.reports for insert with check (reporter = auth.uid());

revoke all on public.blocks, public.reports from anon;
revoke update, truncate on public.blocks from authenticated;
revoke select, update, delete, truncate on public.reports from authenticated;

-- Leaderboard now hides players you blocked.
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
    and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = r.user_id)
    and (
      not p_friends
      or r.user_id = auth.uid()
      or exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = r.user_id)
    )
  order by r.score desc, r.created_at asc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Most-reported players first (run in the dashboard SQL editor).
create view public.moderation_queue with (security_invoker = true) as
select p.username, count(*) as reports, max(r.created_at) as last_report,
  array_agg(distinct r.reason) as reasons
from public.reports r join public.profiles p on p.id = r.reported
group by p.username
order by reports desc, last_report desc;

revoke all on public.moderation_queue from anon, authenticated;
