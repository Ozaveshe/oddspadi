-- GENERATED FILE - do not edit by hand.
--
-- Produced from src/lib/markets/canonicalMarkets.ts via
-- src/lib/markets/canonicalSeed.ts. The registry is the source of truth; this
-- mirror exists only so the mapping workbench can join impact queries in SQL.
--
-- canonical-market-mirror.test.ts regenerates this file and compares, so a
-- registry change without a regenerated seed fails the build rather than
-- shipping a mirror describing the previous rules.
--
-- Regenerate with: npm run docs:canonical-seed
--
-- Selection keys here carry no line: a line is a property of a quote, not of a
-- selection's identity in the registry. The full key with its line
-- (football.asian_handicap.regulation.home.-0_25) is formed at resolution.

delete from public.op_canonical_selections;
delete from public.op_canonical_markets;

insert into public.op_canonical_markets (
  key, version, sport, family, period, participant_scope, selection_type,
  line_required, line_granularity, basis, overtime_rule, push_rule, void_rule,
  retirement_rule, settlement_rule_version, settlement_basis_statement
) values
  ('football.1x2.regulation', '2026-08-07.1', 'football', '1x2', 'regulation', 'match', 'ternary', false, 'none', 'regulation', 'excluded', 'no_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'Settles on the score at the end of normal time. Extra time and penalties are ignored, so a cup tie level after 90 minutes settles as a draw however it was eventually decided.'),
  ('football.double_chance.regulation', '2026-08-07.1', 'football', 'double_chance', 'regulation', 'match', 'ternary', false, 'none', 'regulation', 'excluded', 'no_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'Settles on the score at the end of normal time; wins if either of the two covered outcomes occurs.'),
  ('football.draw_no_bet.regulation', '2026-08-07.1', 'football', 'draw_no_bet', 'regulation', 'match', 'binary', false, 'none', 'regulation', 'excluded', 'exact_line_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'Settles on the score at the end of normal time. A draw returns the stake as a push.'),
  ('football.asian_handicap.regulation', '2026-08-07.1', 'football', 'asian_handicap', 'regulation', 'match', 'handicap', true, 'quarter', 'regulation', 'excluded', 'quarter_line_half_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'The line is applied to the selection''s normal-time score. A whole line landing exactly returns the stake; a quarter line splits the stake between the two neighbouring half lines, producing a half win or half loss.'),
  ('football.total_goals.regulation', '2026-08-07.1', 'football', 'total_goals', 'regulation', 'match', 'total', true, 'quarter', 'regulation', 'excluded', 'exact_line_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'Settles on total goals in normal time. A total landing exactly on a whole line returns the stake.'),
  ('football.btts.regulation', '2026-08-07.1', 'football', 'btts', 'regulation', 'match', 'binary', false, 'none', 'regulation', 'excluded', 'no_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'Settles on whether both teams scored in normal time.'),
  ('football.to_qualify.including_shootout', '2026-08-07.1', 'football', 'to_qualify', 'including_shootout', 'match', 'binary', false, 'none', 'including_shootout', 'included', 'no_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'Settles on which side advanced, counting extra time and a penalty shootout. This is the only football market here that reads past normal time.'),
  ('basketball.moneyline.full_game_incl_ot', '2026-08-07.1', 'basketball', 'moneyline', 'full_game_incl_ot', 'match', 'binary', false, 'none', 'full_game_including_ot', 'included', 'no_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'Settles on the final score including any overtime played. This is the market default; the regulation-only variant is a separate market, never a flag on this one.'),
  ('basketball.moneyline.regulation', '2026-08-07.1', 'basketball', 'moneyline', 'regulation', 'match', 'ternary', false, 'none', 'regulation_excluding_ot', 'excluded', 'no_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'Settles on the score at the end of the fourth quarter, before any overtime. A game tied at that point settles the draw selection, which is why this market is three-way where the full-game market is two-way.'),
  ('basketball.spread.full_game_incl_ot', '2026-08-07.1', 'basketball', 'spread', 'full_game_incl_ot', 'match', 'handicap', true, 'half', 'full_game_including_ot', 'included', 'exact_line_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'The line is applied to the selection''s final score including overtime. A margin landing exactly on a whole line returns the stake.'),
  ('basketball.total_points.full_game_incl_ot', '2026-08-07.1', 'basketball', 'total_points', 'full_game_incl_ot', 'match', 'total', true, 'half', 'full_game_including_ot', 'included', 'exact_line_push', 'void_on_no_result', 'not_applicable', '2026-08-07.1', 'Settles on combined points including overtime. A total landing exactly on a whole line returns the stake.'),
  ('tennis.match_winner.full_match', '2026-08-07.1', 'tennis', 'match_winner', 'full_match', 'player', 'binary', false, 'none', 'match_award', 'not_applicable', 'no_push', 'settle_if_awarded', 'settle_on_award', '2026-08-07.1', 'Settles on the player awarded the match. A retirement still produces a winner and settles; a walkover, where no play took place, voids.'),
  ('tennis.set_handicap.full_match', '2026-08-07.1', 'tennis', 'set_handicap', 'full_match', 'player', 'handicap', true, 'half', 'sets', 'not_applicable', 'exact_line_push', 'void_on_no_result', 'void', '2026-08-07.1', 'The line is applied to sets won in a completed match. A retirement voids, because the set count never reached its final value even though the match has a winner.'),
  ('tennis.total_games.full_match', '2026-08-07.1', 'tennis', 'total_games', 'full_match', 'match', 'total', true, 'half', 'games', 'not_applicable', 'exact_line_push', 'void_on_no_result', 'void', '2026-08-07.1', 'Settles on total games in a completed match. A retirement voids, because games that would have been played were not.');

insert into public.op_canonical_selections (key, market_key, selection, label) values
  ('football.1x2.regulation.home', 'football.1x2.regulation', 'home', 'Home win'),
  ('football.1x2.regulation.draw', 'football.1x2.regulation', 'draw', 'Draw'),
  ('football.1x2.regulation.away', 'football.1x2.regulation', 'away', 'Away win'),
  ('football.double_chance.regulation.1x', 'football.double_chance.regulation', '1x', 'Home or draw'),
  ('football.double_chance.regulation.12', 'football.double_chance.regulation', '12', 'Home or away'),
  ('football.double_chance.regulation.x2', 'football.double_chance.regulation', 'x2', 'Draw or away'),
  ('football.draw_no_bet.regulation.home', 'football.draw_no_bet.regulation', 'home', 'Home'),
  ('football.draw_no_bet.regulation.away', 'football.draw_no_bet.regulation', 'away', 'Away'),
  ('football.asian_handicap.regulation.home', 'football.asian_handicap.regulation', 'home', 'Home'),
  ('football.asian_handicap.regulation.away', 'football.asian_handicap.regulation', 'away', 'Away'),
  ('football.total_goals.regulation.over', 'football.total_goals.regulation', 'over', 'Over'),
  ('football.total_goals.regulation.under', 'football.total_goals.regulation', 'under', 'Under'),
  ('football.btts.regulation.yes', 'football.btts.regulation', 'yes', 'Both teams to score'),
  ('football.btts.regulation.no', 'football.btts.regulation', 'no', 'Not both teams to score'),
  ('football.to_qualify.including_shootout.home', 'football.to_qualify.including_shootout', 'home', 'Home'),
  ('football.to_qualify.including_shootout.away', 'football.to_qualify.including_shootout', 'away', 'Away'),
  ('basketball.moneyline.full_game_incl_ot.home', 'basketball.moneyline.full_game_incl_ot', 'home', 'Home'),
  ('basketball.moneyline.full_game_incl_ot.away', 'basketball.moneyline.full_game_incl_ot', 'away', 'Away'),
  ('basketball.moneyline.regulation.home', 'basketball.moneyline.regulation', 'home', 'Home win in regulation'),
  ('basketball.moneyline.regulation.draw', 'basketball.moneyline.regulation', 'draw', 'Tied after regulation'),
  ('basketball.moneyline.regulation.away', 'basketball.moneyline.regulation', 'away', 'Away win in regulation'),
  ('basketball.spread.full_game_incl_ot.home', 'basketball.spread.full_game_incl_ot', 'home', 'Home'),
  ('basketball.spread.full_game_incl_ot.away', 'basketball.spread.full_game_incl_ot', 'away', 'Away'),
  ('basketball.total_points.full_game_incl_ot.over', 'basketball.total_points.full_game_incl_ot', 'over', 'Over'),
  ('basketball.total_points.full_game_incl_ot.under', 'basketball.total_points.full_game_incl_ot', 'under', 'Under'),
  ('tennis.match_winner.full_match.player_a', 'tennis.match_winner.full_match', 'player_a', 'Player A'),
  ('tennis.match_winner.full_match.player_b', 'tennis.match_winner.full_match', 'player_b', 'Player B'),
  ('tennis.set_handicap.full_match.player_a', 'tennis.set_handicap.full_match', 'player_a', 'Player A'),
  ('tennis.set_handicap.full_match.player_b', 'tennis.set_handicap.full_match', 'player_b', 'Player B'),
  ('tennis.total_games.full_match.over', 'tennis.total_games.full_match', 'over', 'Over'),
  ('tennis.total_games.full_match.under', 'tennis.total_games.full_match', 'under', 'Under');
