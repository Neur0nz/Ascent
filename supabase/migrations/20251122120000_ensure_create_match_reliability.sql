begin;

-- 1. Ensure public matches can have join codes (idempotent fix for constraints)
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

-- 2. Explicitly allow service_role to INSERT/UPDATE matches
-- This is required if RLS is active and service_role is not bypassing it.
drop policy if exists "Matches - service_role insert" on public.matches;
create policy "Matches - service_role insert"
  on public.matches
  for insert
  with check (
    current_setting('role', true) = 'service_role'
  );

drop policy if exists "Matches - service_role update" on public.matches;
create policy "Matches - service_role update"
  on public.matches
  for update
  using (
    current_setting('role', true) = 'service_role'
  )
  with check (
    current_setting('role', true) = 'service_role'
  );

-- 3. Explicitly allow service_role to INSERT/UPDATE players (for AI provisioning)
drop policy if exists "Players - service_role insert" on public.players;
create policy "Players - service_role insert"
  on public.players
  for insert
  with check (
    current_setting('role', true) = 'service_role'
  );

drop policy if exists "Players - service_role update" on public.players;
create policy "Players - service_role update"
  on public.players
  for update
  using (
    current_setting('role', true) = 'service_role'
  )
  with check (
    current_setting('role', true) = 'service_role'
  );

-- 4. Ensure the SELECT policy covers service_role (reinforcing previous fix)
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
