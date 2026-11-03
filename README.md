# Birdie Collective · Live League Board

Branded live leaderboard for the lounge TV. It runs on top of SGT's own site with the TV's SGT login, so scores come straight from SGT and refresh every 60 seconds.

- `board.js` — the board (hides SGT's page, draws the Birdie board, shows this week's live leaderboard)
- `league.json` — team names, colors, logos, and which SGT usernames belong to which team
- `logos/`, `brand/` — team row logos and Birdie marks
- `loader.js` — the one line pasted into Fully Kiosk → Advanced Web Settings → Inject JavaScript

**TV start URL:** `https://simulatorgolftour.com/tour/3766#bclive`

Options after `#bclive`: `&view=season` to show season standings instead (not used on the TV), `&event=78792` to force an SGT event.

Picks the current week automatically: the newest SGT event that has opened. SGT keeps each week open a couple of days past Sunday, so this makes the board switch to the new week and course Monday at midnight. The opening day comes from the event page's date range when it reads sensibly; otherwise it's worked out from the league calendar (Monday of the week the event closes in, counting back 3 days), so a failed page read can't leave the board on last week's finished results.

Live rounds: a team counts as on course when SGT's row is marked in progress, or its score shows holes played ("E (1)", "-2 THRU 7", "-3 *12*"), or a THRU column shows a hole number. Only an F means finished. New SGT usernames that aren't in `league.json` still show up, by username, until they're added.
