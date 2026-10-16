-- In-app account deletion (required by App Store guideline 5.1.1(v)).
-- Deleting the auth user cascades to profile, results, follows and reactions.
create or replace function public.delete_my_account()
returns void
language sql volatile security definer set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
