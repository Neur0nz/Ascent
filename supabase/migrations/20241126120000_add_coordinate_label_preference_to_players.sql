alter table public.players
  add column if not exists show_coordinate_labels boolean not null default true;

update public.players
set show_coordinate_labels = true
where show_coordinate_labels is null;
