-- Change default to false and update existing rows
alter table public.players
  alter column show_last_move_indicator set default false;

update public.players
set show_last_move_indicator = false
where show_last_move_indicator = true;

