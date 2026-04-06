# Cinema Aggregator — Development Rules

## Versioning (MANDATORY)
Every time `index.html` is edited, you MUST:
1. Bump the version number (e.g. v2.1 -> v2.2) in ALL locations: `<title>`, navbar `<span>`, and changelog
2. Add a changelog entry under Version History describing what changed
3. The API_BASE must always be: `https://silver-dollop-4zjb.onrender.com/api`

## File structure
- `index.html` — the full cinema aggregator frontend (single-file app)
- `server/server.js` — Express API backend (deployed on Render.com)
- `server/data/cinema-data.json` — all user data (users, schedules, profiles, viewed movies)
- `server/package.json` — Node.js dependencies

## Deployment
- Frontend: GitHub Pages at `https://phyrouz.github.io/silver-dollop/`
- Backend: Render.com at `https://silver-dollop-4zjb.onrender.com`
- Repo: `https://github.com/Phyrouz/silver-dollop`

## Data format
Schedule entries must use flat format (NOT nested showtime):
```json
{ "title": "...", "date": "2026-04-05", "time": "13:30", "venue": "...", "booked": true }
```
NOT: `{ "showtime": { "date": "...", "time": "..." } }`

## Schedule (original user movies — do not remove)
The user's personal schedule includes these movies. Never delete them:
- La Notte (1961) — Apr 5, The Garden Cinema
- A Touch of Sin (2013) — Apr 8, The Garden Cinema
- Father Mother Sister Brother (2025) — Apr 15, The Garden Cinema
- Mountains May Depart (2015) — Apr 16, The Garden Cinema
- Pickpocket (1959) — Apr 30, BFI Southbank
- La cienaga (2001) — May 18, The Garden Cinema
- Brazil 1967 (1965) — May 21, BFI Southbank
- In The Mood For Love (2000) — Jun 10, Prince Charles Cinema
- Zama (2018) — Jun 11, The Garden Cinema
- El secreto de sus ojos (2009) — Jun 16, The Garden Cinema
