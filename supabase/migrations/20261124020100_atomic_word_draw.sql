begin;

create or replace function public.draw_quiz_word_turn(
  p_room_code text, p_version bigint, p_game_id text, p_turn integer,
  p_player text, p_action text, p_catalog jsonb
)
returns table (version bigint, state jsonb)
language plpgsql security invoker set search_path = ''
as $$
declare
  game_row public.quiz_word_games%rowtype;
  game jsonb;
  category text;
  card jsonb;
  cards jsonb := '[]';
  used_cards jsonb;
  writer text;
  allowed boolean;
begin
  select g.* into game_row from public.quiz_word_games g
  where g.room_code = p_room_code for update;
  game := game_row.state;
  if game is null or game_row.version is distinct from p_version
     or game->>'id' is distinct from p_game_id or game->>'mode' is distinct from 'relay'
     or jsonb_array_length(game->'turns') is distinct from p_turn
     or p_turn >= (game->>'total')::integer then
    return;
  end if;

  writer := game->'players'->>(p_turn % 2);
  allowed := p_player = writer and (
    (p_action = 'start' and game->>'status' = 'setup' and p_turn = 0
      and jsonb_array_length(game->'consent') = 2)
    or (p_action = 'next' and game->>'status' = 'scored' and p_turn > 0)
  );
  if not coalesce(allowed, false) then return; end if;

  -- The row lock is held before any random selection. A stale request cannot draw.
  used_cards := game->'used';
  foreach category in array array['人物','地點','物品','動作','轉折'] loop
    select entry.value into card from jsonb_array_elements(p_catalog) entry(value)
    where entry.value->>'category' = category
      and (game->>'theme' = '混搭' or entry.value->>'theme' = game->>'theme')
      and not (used_cards ? (entry.value->>'id'))
    order by random() limit 1;
    -- Relay allows at most eight draws from a pool of twelve per theme and category.
    if card is null then raise exception 'Relay category has no eligible card'; end if;
    cards := cards || jsonb_build_array(card);
    used_cards := used_cards || jsonb_build_array(card->>'id');
  end loop;

  game := game || jsonb_build_object('status', 'writing', 'used', used_cards,
    'turns', (game->'turns') || jsonb_build_array(jsonb_build_object(
      'number', p_turn + 1, 'writer', writer, 'cards', cards,
      'deadline', floor(extract(epoch from clock_timestamp()) * 1000)::bigint + 120000
    )));
  return query update public.quiz_word_games g set version = g.version + 1, state = game
    where g.room_code = p_room_code returning g.version, g.state;
end $$;

revoke all on function public.draw_quiz_word_turn(text, bigint, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.draw_quiz_word_turn(text, bigint, text, integer, text, text, jsonb) to service_role;

commit;
