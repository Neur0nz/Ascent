create table if not exists public.match_ping_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  sender_id uuid not null references public.players (id) on delete cascade,
  recipient_id uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists match_ping_events_match_sender_idx
  on public.match_ping_events (match_id, sender_id, created_at desc);

alter table public.match_ping_events enable row level security;
