create or replace function public.set_web_push_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null references public.players (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  encoding text not null default 'aesgcm',
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists web_push_subscriptions_profile_id_idx on public.web_push_subscriptions (profile_id);
create index if not exists web_push_subscriptions_auth_user_id_idx on public.web_push_subscriptions (auth_user_id);

alter table public.web_push_subscriptions enable row level security;

create policy if not exists "Allow users to manage their push subscriptions" on public.web_push_subscriptions
  for all
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

drop trigger if exists set_web_push_updated_at on public.web_push_subscriptions;

create trigger set_web_push_updated_at
before update on public.web_push_subscriptions
for each row
execute procedure public.set_web_push_updated_at();
