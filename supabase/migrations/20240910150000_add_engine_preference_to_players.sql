alter table if exists public.players
  add column if not exists engine_preference text not null default 'python'
    constraint players_engine_preference_check check (engine_preference in ('python', 'rust'));

update public.players
   set engine_preference = 'python'
 where engine_preference is null;
