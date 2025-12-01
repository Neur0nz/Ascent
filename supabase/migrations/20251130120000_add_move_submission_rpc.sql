-- Add the get_move_submission_data RPC function for the submit-move edge function
-- This function returns match data, last move, and player role in a single query
-- IMPORTANT: Returns full match record including clock_increment_seconds for increment support

create or replace function public.get_move_submission_data(
  p_auth_user_id uuid,
  p_match_id uuid
)
returns table (
  match_data jsonb,
  last_move_data jsonb,
  player_id uuid,
  player_role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_player_role text;
  v_match_record record;
  v_last_move record;
begin
  -- Find the player profile for the auth user
  select id into v_player_id
  from public.players
  where auth_user_id = p_auth_user_id
  limit 1;

  if v_player_id is null then
    raise exception 'Player profile not found for auth user';
  end if;

  -- Fetch the match
  select * into v_match_record
  from public.matches
  where id = p_match_id;

  if v_match_record is null then
    raise exception 'Match not found';
  end if;

  -- Determine player role
  if v_match_record.creator_id = v_player_id then
    v_player_role := 'creator';
  elsif v_match_record.opponent_id = v_player_id then
    v_player_role := 'opponent';
  else
    raise exception 'User is not a participant in this match';
  end if;

  -- Fetch the last move for this match
  select * into v_last_move
  from public.match_moves
  where match_id = p_match_id
  order by move_index desc
  limit 1;

  -- Return all data
  return query select
    to_jsonb(v_match_record) as match_data,
    case when v_last_move is null then null else to_jsonb(v_last_move) end as last_move_data,
    v_player_id as player_id,
    v_player_role as player_role;
end;
$$;

-- Grant execute permission to authenticated users
grant execute on function public.get_move_submission_data(uuid, uuid) to authenticated;
grant execute on function public.get_move_submission_data(uuid, uuid) to service_role;

comment on function public.get_move_submission_data is
  'Returns match data, last move, and player role for the submit-move edge function. '
  'Includes all match fields (clock_initial_seconds, clock_increment_seconds, etc.) for proper clock handling.';


