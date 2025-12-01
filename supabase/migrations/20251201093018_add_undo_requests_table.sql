-- Create undo_requests table for persisting undo request state
-- This ensures undo requests are not lost when players' browsers are backgrounded

create table if not exists public.undo_requests (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  requested_by uuid not null references public.players(id),
  move_index integer not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  responded_by uuid references public.players(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.undo_requests enable row level security;

-- Index for quick lookups by match
create index if not exists undo_requests_match_id_idx on public.undo_requests(match_id);
create index if not exists undo_requests_match_status_idx on public.undo_requests(match_id, status);

-- RLS policies (similar to abort_requests)

-- Insert policy: only match participants can create undo requests
create policy "Undo requests - insert participant"
  on public.undo_requests
  for insert
  with check (
    exists (
      select 1
      from public.matches m
      join public.players p
        on p.id = public.undo_requests.requested_by
      where m.id = public.undo_requests.match_id
        and m.status = 'in_progress'
        and p.auth_user_id = (select auth.uid())
        and (p.id = m.creator_id or p.id = m.opponent_id)
    )
  );

-- Update policy: only match participants can update undo requests
create policy "Undo requests - update participant"
  on public.undo_requests
  for update
  using (
    exists (
      select 1
      from public.matches m
      join public.players p
        on (p.id = m.creator_id or p.id = m.opponent_id)
      where m.id = public.undo_requests.match_id
        and p.auth_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.matches m
      join public.players p
        on (p.id = m.creator_id or p.id = m.opponent_id)
      where m.id = public.undo_requests.match_id
        and p.auth_user_id = (select auth.uid())
    )
  );

-- Select policy: only match participants can view undo requests
create policy "Undo requests - select participant"
  on public.undo_requests
  for select
  using (
    exists (
      select 1
      from public.matches m
      join public.players p
        on (p.id = m.creator_id or p.id = m.opponent_id)
      where m.id = public.undo_requests.match_id
        and p.auth_user_id = (select auth.uid())
    )
  );

-- Delete policy: only match participants can delete undo requests
create policy "Undo requests - delete participant"
  on public.undo_requests
  for delete
  using (
    exists (
      select 1
      from public.matches m
      join public.players p
        on (p.id = m.creator_id or p.id = m.opponent_id)
      where m.id = public.undo_requests.match_id
        and p.auth_user_id = (select auth.uid())
    )
  );

