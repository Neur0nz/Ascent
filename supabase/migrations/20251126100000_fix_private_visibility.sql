begin;

-- Tighten match visibility: private matches should only be visible to participants (except service_role).
-- Idempotent drop of prior permissive policies.
drop policy if exists "Matches - select access" on public.matches;
drop policy if exists "Public matches are visible to everyone" on public.matches;
drop policy if exists "Private matches can be viewed with join code" on public.matches;

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
