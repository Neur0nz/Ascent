begin;

-- Restrict match visibility to prevent leaking private lobbies
drop policy if exists "Matches - select access" on public.matches;
create policy "Matches - select access"
  on public.matches
  for select
  using (
    visibility = 'public'
    or exists (
      select 1
      from public.players p
      where p.auth_user_id = (select auth.uid())
        and (p.id = public.matches.creator_id or p.id = public.matches.opponent_id)
    )
  );

-- Only participants may update matches (joining is now handled by join-match function)
drop policy if exists "Matches - participant update" on public.matches;
create policy "Matches - participant update"
  on public.matches
  for update
  using (
    exists (
      select 1
      from public.players p
      where p.auth_user_id = (select auth.uid())
        and (p.id = public.matches.creator_id or p.id = public.matches.opponent_id)
    )
  )
  with check (
    exists (
      select 1
      from public.players p
      where p.auth_user_id = (select auth.uid())
        and (p.id = public.matches.creator_id or p.id = public.matches.opponent_id)
    )
  );

commit;
