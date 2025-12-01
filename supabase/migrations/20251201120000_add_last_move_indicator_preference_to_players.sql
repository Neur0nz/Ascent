alter table public.players
  add column if not exists show_last_move_indicator boolean not null default true;

update public.players
set show_last_move_indicator = true
where show_last_move_indicator is null;

