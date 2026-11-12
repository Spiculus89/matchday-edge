# Data run runbook

This is what each scheduled run does. Each match follows the schema of the existing files in `public/data/` (use the newest one as the template).

1. **Pick the matches.** Find today's fixtures (Europe/Warsaw date) and keep the 4–6 most popular: Champions League, Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Europa League, Nations League A, major internationals, then Ekstraklasa and other top leagues, plus big clubs and national teams. Skip youth and women's games unless nothing else is on.
2. **Gather the data for each match:**
   - **Odds:** bet365 decimal odds from kickoff.co.uk (`/…-predictions-stats-odds/<home>-vs-<away>/`): 1X2, O/U 0.5–5.5, BTTS, double chance, DNB, win to nil, first goal. Cross-check 1X2, O/U 2.5 and BTTS against a second site (footballpredictions.ai, oddschecker, sportinglife). Never copy one match's ladder into another.
   - **Stats:** statz.ai h2h page for the referee and their per-game fouls, yellows and reds; predicted or confirmed XIs; season per-game corners, fouls, shots and shots on target; top scorers and shooters; bet365 player props.
   - **Form:** kickoff.co.uk 20-game form, giving goals for/against and xG for/against.
   - **Team news:** injuries, suspensions, returns and new coaches from SoccerNews, Sports Mole, WhoScored, Oddschecker and the clubs' or federations' own posts.
   - **Lineups:** confirmed lineups about 60 minutes before kick-off from WhoScored "confirmed lineups", statz.ai, or federation and club accounts. Confirm with two sources.
3. **Build the players list:**
   - Starters get `start` 1 once confirmed and bench players 0.
   - Before that, players in the predicted XI get 0.75–0.9, rotation risks 0.3–0.5, and injured or suspended players are left out.
   - Set `adjust.home` or `adjust.away` to 0.92 when a confirmed XI is missing 2+ of the usual top-3 attackers, and to 0.96 for heavy rotation.
4. **Write the files.** Write `public/data/<date>.json`, add the date to `public/data/index.json` (newest first, keep the last 14 days), and set `updated` to the current UTC time.
5. **Check and push.** Run `npm run check -- <date>` and `npm test`, and fix anything marked BAD. Then commit ("Data: <date> <morning|lineups|evening> update") and push to `main`.
