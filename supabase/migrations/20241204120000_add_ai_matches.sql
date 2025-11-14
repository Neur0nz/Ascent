alter table if exists public.matches
  add column if not exists is_ai_match boolean not null default false,
  add column if not exists ai_depth integer;

alter table if exists public.matches
  drop constraint if exists matches_ai_depth_check;

alter table if exists public.matches
  add constraint matches_ai_depth_check
  check (
    ai_depth is null
    or (ai_depth between 10 and 5000)
  );

alter table if exists public.matches
  drop constraint if exists matches_ai_settings_check;

alter table if exists public.matches
  add constraint matches_ai_settings_check
  check (
    is_ai_match = false
    or (
      rated = false
      and coalesce(clock_initial_seconds, 0) = 0
      and coalesce(clock_increment_seconds, 0) = 0
    )
  );

insert into public.players (
  id,
  auth_user_id,
  display_name,
  avatar_url,
  rating,
  games_played,
  created_at,
  updated_at,
  engine_preference,
  show_coordinate_labels
)
values (
  '00000000-0000-0000-0000-00000000a11a',
  null,
  'Santorini AI',
  null,
  1500,
  0,
  now(),
  now(),
  'python',
  true
)
on conflict (id) do update set
  display_name = excluded.display_name,
  updated_at = now();
