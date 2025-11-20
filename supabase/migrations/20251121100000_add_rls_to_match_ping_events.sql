begin;

-- Grant access to match participants for ping events
create policy "Match ping events - select access for participants"
  on public.match_ping_events
  for select
  using (
    exists (
      select 1
      from public.matches m
      join public.players p
        on (p.id = m.creator_id or p.id = m.opponent_id)
      where m.id = public.match_ping_events.match_id
        and p.auth_user_id = (select auth.uid())
    )
  );

create policy "Match ping events - insert access for participants"
  on public.match_ping_events
  for insert
  with check (
    exists (
      select 1
      from public.matches m
      join public.players p
        on (p.id = m.creator_id or p.id = m.opponent_id)
      where m.id = public.match_ping_events.match_id
        and p.id = public.match_ping_events.sender_id
        and p.auth_user_id = (select auth.uid())
    )
  );

commit;
