# Birdie Collective · Live League Board

Branded live leaderboard for the lounge TV. It runs on top of SGT's own site with the TV's SGT login, so scores come straight from SGT and refresh every 60 seconds.

- `board.js` — the board (hides SGT's page, draws the Birdie board, shows this week's live leaderboard)
- `league.json` — team names, colors, logos, and which SGT usernames belong to which team
- `logos/`, `brand/` — team row logos and Birdie marks
- `loader.js` — the one line pasted into Fully Kiosk → Advanced Web Settings → Inject JavaScript

**TV start URL:** `https://simulatorgolftour.com/tour/3766#bclive`

Options after `#bclive`: `&view=season` to show season standings instead (not used on the TV), `&event=78792` to force an SGT event.

Picks the current week automatically (the open SGT event with the soonest end date), so it rolls to the next week and course on its own the day after a week ends. New SGT usernames that aren't in `league.json` still show up, by username, until they're added.
