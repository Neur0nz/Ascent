begin;

-- 1. Remove any constraint that prevents public matches from having a join code
do $$
declare
    r record;
begin
    for r in
        select conname
        from pg_constraint
        where conrelid = 'public.matches'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%visibility%'
          and pg_get_constraintdef(oid) ilike '%private_join_code%'
    loop
        execute 'alter table public.matches drop constraint ' || quote_ident(r.conname);
    end loop;
end $$;

-- 2. Update RLS policy to explicitly allow service_role (just in case)
-- and ensure public matches are visible, and private matches are visible to participants.
drop policy if exists "Matches - select access" on public.matches;
create policy "Matches - select access"
  on public.matches
  for select
  using (
    current_setting('role', true) = 'service_role'
    or visibility = 'public'
    or exists (
      select 1
      from public.players p
      where p.auth_user_id = (select auth.uid())
        and (p.id = public.matches.creator_id or p.id = public.matches.opponent_id)
    )
  );

commit;
