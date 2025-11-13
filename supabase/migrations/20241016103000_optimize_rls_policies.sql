-- Optimize RLS policies to avoid redundant auth evaluations and reduce
-- overlapping permissive policies per Supabase advisor guidance.
begin;

-- Matches policies ---------------------------------------------------------
drop policy if exists "Public matches are visible to everyone" on public.matches;
drop policy if exists "Private matches can be viewed with join code" on public.matches;
drop policy if exists "Participants can update their match" on public.matches;
drop policy if exists "Players can join open matches" on public.matches;
drop policy if exists "Creators can manage their matches" on public.matches;

create policy "Matches - select access"
  on public.matches
  for select
  using (
    visibility = 'public'
    or (
      visibility = 'private'
      and private_join_code is not null
    )
    or exists (
      select 1
      from public.players p
      where p.auth_user_id = (select auth.uid())
        and (p.id = public.matches.creator_id or p.id = public.matches.opponent_id)
    )
  );

create policy "Matches - creator insert"
  on public.matches
  for insert
  with check (
    exists (
      select 1
      from public.players p
      where p.id = public.matches.creator_id
        and p.auth_user_id = (select auth.uid())
    )
  );

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
    or (
      public.matches.status = 'waiting_for_opponent'
      and public.matches.opponent_id is null
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

-- Players policies ---------------------------------------------------------
drop policy if exists "Players can view public profiles" on public.players;
drop policy if exists "Players can view their profile" on public.players;
drop policy if exists "Players can insert their profile" on public.players;
drop policy if exists "Players can update their profile" on public.players;

create policy "Players - select access"
  on public.players
  for select
  using (true);

create policy "Players - insert self"
  on public.players
  for insert
  with check (auth_user_id = (select auth.uid()));

create policy "Players - update self"
  on public.players
  for update
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- Abort requests policies --------------------------------------------------
drop policy if exists "Players can create abort requests" on public.abort_requests;
drop policy if exists "Players can respond to abort requests" on public.abort_requests;
drop policy if exists "Players can view abort requests for their matches" on public.abort_requests;

create policy "Abort requests - insert participant"
  on public.abort_requests
  for insert
  with check (
    exists (
      select 1
      from public.matches m
      join public.players p
        on p.id = public.abort_requests.requested_by
      where m.id = public.abort_requests.match_id
        and m.status = 'in_progress'
        and p.auth_user_id = (select auth.uid())
        and (p.id = m.creator_id or p.id = m.opponent_id)
    )
  );

create policy "Abort requests - update participant"
  on public.abort_requests
  for update
  using (
    exists (
      select 1
      from public.matches m
      join public.players p
        on (p.id = m.creator_id or p.id = m.opponent_id)
      where m.id = public.abort_requests.match_id
        and p.auth_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.matches m
      join public.players p
        on (p.id = m.creator_id or p.id = m.opponent_id)
      where m.id = public.abort_requests.match_id
        and p.auth_user_id = (select auth.uid())
    )
  );

create policy "Abort requests - select participant"
  on public.abort_requests
  for select
  using (
    exists (
      select 1
      from public.matches m
      join public.players p
        on (p.id = m.creator_id or p.id = m.opponent_id)
      where m.id = public.abort_requests.match_id
        and p.auth_user_id = (select auth.uid())
    )
  );

-- Web push subscriptions ---------------------------------------------------
drop policy if exists "Allow users to manage their push subscriptions" on public.web_push_subscriptions;

create policy "Web push subscriptions - manage own records"
  on public.web_push_subscriptions
  for all
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

commit;
