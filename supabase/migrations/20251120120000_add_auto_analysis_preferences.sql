alter table public.players
  add column if not exists auto_analyze_games boolean not null default false,
  add column if not exists auto_analyze_depth integer not null default 800;

update public.players
set auto_analyze_depth = 800
where auto_analyze_depth is null;
