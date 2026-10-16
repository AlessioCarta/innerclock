<p align="center">
  <img src="public/icon.svg" width="96" alt="InnerClock logo" />
</p>

<h1 align="center">InnerClock ⏱️</h1>

<p align="center"><b>How accurate is your inner clock?</b><br/>
A daily social game: hold the button for <i>exactly</i> the time shown — with no timer on screen.<br/>
Everyone in the world gets the same five targets each day. Beat your friends.</p>

```
⏱️ InnerClock #12 — 431/500
🟪🟩🟨🟪🟩  Metronome

🟪 2.1s → 2.13s (+0.03)
🟩 3.8s → 3.67s (−0.13)
...
Can you beat me? https://…/?vs=time_lord
```

## Why it spreads

| Mechanic | Why it works |
|---|---|
| **One daily puzzle, same for everyone** | Creates a shared conversation every day (the Wordle effect). |
| **No-spoiler leaderboard** | Today's scores unlock only after you play — the BeReal "post to see" hook. |
| **Emoji grid share** | Spoiler-free, copy-pasteable into any chat or social feed. |
| **Challenge links** (`?vs=username`) | Every share is a 1v1 invitation with a head-to-head result and one-tap follow. |
| **Friends board + reactions** 🔥🎯😂🫠⚡ | Social proof and a reason to come back and check. |
| **Streaks** | Daily habit loop. |
| **10-second rounds** | A full game takes under a minute. |

## Features

- 🎯 5 rounds/day, from ~1s to ~15s, with tiers 🟪 Atomic (≤2%) · 🟩 Sharp (≤5%) · 🟨 Close (≤10%) · 🟧 Drifting (≤20%) · 🟥 Lost in time
- 🌍 Live global leaderboard (Supabase Realtime) and a friends-only board
- 👤 Zero-friction accounts: anonymous sign-in + username, optional email to sync devices
- 🛡️ **Server-authoritative scoring** — Postgres recomputes targets and scores from the submitted holds; the score itself can’t be forged
- 🙈 Row Level Security: you can't see today's results until you've submitted your own
- 📱 Mobile-first, keyboard (Space) and touch, PWA-installable, works offline in guest mode
- ✅ Tests that prove the JS and SQL scoring are bit-for-bit identical (via [PGlite](https://pglite.dev))

## Quick start

```bash
npm install
npm run dev        # guest mode: solo play + share, no backend needed
npm test
```

### Turn on the social layer (Supabase, free tier)

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Sign In / Providers → Anonymous sign-ins: enable.**
3. Apply the schema — either paste both files from `supabase/migrations/` (in order) into the SQL editor, or:
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
4. `cp .env.example .env.local` and fill in the Project URL and anon key (Project Settings → API).
5. `npm run dev` — you now have accounts, leaderboards, friends and reactions.

### Deploy to GitHub Pages

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Repo **Settings → Secrets and variables → Actions → Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Push to `main`. The workflow runs the tests, builds, and deploys.
4. In Supabase **Authentication → URL Configuration**, add your Pages URL as Site URL.

## How it works

```
src/core.js     pure game logic (targets, scoring, share text) — shared by app & tests
src/api.js      Supabase calls (auth, results, leaderboard RPCs, realtime)
src/main.js     UI: home → play → results/leaderboard, profile sheet
supabase/migrations/
  …0001_game_functions.sql   ic_targets / ic_score — mirror core.js exactly
  …0002_social.sql           tables, RLS, triggers, leaderboard RPCs
test/           node:test — core logic + JS⇄SQL parity on PGlite
```

Targets are derived from `SHA-256("innerclock:<day>:<round>")` with integer math only, so the browser and Postgres compute identical values. Scores use integer milliseconds for the same reason.

## Security notes

- Scores are recomputed in Postgres; results are immutable; RLS hides today's results, reactions and play status until you've played (covered by `test/social.test.js`).
- Hold durations are measured in the browser, so a determined cheater can still submit perfect times. That's the honest limit of any reaction/timing game without server-side timing (network jitter would ruin accuracy). Treat the global board as casual.
- Before launch, in Supabase: **enable CAPTCHA for sign-ins** (Auth → Attack Protection) and review **Auth rate limits** to slow down bot accounts.

## Roadmap ideas

- [ ] Weekly leagues and seasonal badges
- [ ] Shareable result image (OG card) per player/day
- [ ] Push reminder before the day ends to save a streak
- [ ] Group rooms (class, office, Discord server)
- [ ] Hard mode: targets with two decimals, or "count backwards"

PRs welcome!

## License

[MIT](LICENSE)
