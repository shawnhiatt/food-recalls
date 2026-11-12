# FDA press relay (T5, 2026-11)

**Why.** Since 2026-10-24, www.fda.gov's Akamai bot manager answers Convex's
shared egress (US-East `216.235.222.0/24`) with HTTP 401 site-wide. A plain fetch
with the app's own User-Agent from a residential IP still gets 200 (see
[the 2026-11 health audit](audits/2026-11-health-audit.md) §1 and §7). The press
feed only holds about 32 days of items, so this relay moves the bytes from a
machine fda.gov serves. Email ingest (T7) is the durable fix for all three
blocked sources.

**Where it runs.** On Shawn's Mac, as a launchd agent every 3 hours.
The T2 probe of Vercel's egress was deployed as a Preview, but its result wasn't
read (Vercel SSO). Vercel Hobby only allows daily crons in any case. If a later probe
shows Vercel gets 200, a route that calls `runRelay` from `scripts/fda-relay.mjs`
can take over. A Convex cron can call it, so the Hobby limit doesn't matter.

## How it works

```
Mac (launchd, every 3h)                      Convex prod (good-lynx-479)
scripts/fda-relay.mjs                        convex/ingest/fdaRelay.ts  POST /relay/fda-rss
  GET fda.gov RSS ───── {step:"feed", rss} ──▶ planFeed (adapter parseRssItems)
                                               reportRun fda_rss success, transport "relay"
                  ◀──── {pages:[new items]}
  GET each new press page
                  ───── {step:"page", item, html} ──▶ recordPressPage (adapter parsePressPage
                                                      → press.recordPressItem → enrich recalls)
  (feed fetch failed?)
                  ───── {step:"failure", error} ──▶ reportRun fda_rss failure, transport "relay"
```

- Auth: `Authorization: Bearer <FDA_RELAY_SECRET>`. If the Convex env var is unset
  the endpoint answers 503. A wrong secret gets 401 and a malformed body gets 400.
  None of those touch `sourceHealth`.
- All parsing and matching stay in Convex, through the same `planFeed` and
  `recordPressPage` path as Convex's own fetch (`convex/ingest/fdaRss.ts`). The
  relay only moves bytes.
- Convex's own 3-hour fetch keeps running. Relink and the Open Food Facts fallback
  run there, and if fda.gov unblocks Convex the feed recovers without anyone
  touching it.

## Health (SPEC §10)

`fda_rss` now has two transports. `sourceHealth` stores `directLastSuccessAt` and
`relayLastSuccessAt`. A failure on one transport **isn't counted** while the other
succeeded within the delayed threshold (2 × the 3-hour interval = 6 hours). Once
the other transport goes quiet, failures count again and the state degrades as
before. So:

| Situation | fda_rss |
|---|---|
| Relay delivering, Convex still 401 | current |
| Mac asleep or offline for more than 6h | delayed (then unavailable after 5 counted failures or 7 days) |
| fda.gov also refuses the Mac | the relay reports the failure, which counts |
| Relay feed parses to 0 items | delayed (anomaly) |

## Install (Mac)

Needs Node on PATH (`/opt/homebrew/bin/node`), plus `FDA_RELAY_SECRET` set on prod
Convex.

```bash
scripts/fda-relay-launchd.sh secret
```
This stores the same secret value in the login Keychain. It prompts twice and doesn't echo the value.

```bash
scripts/fda-relay-launchd.sh install
```
This copies the relay to `~/Library/Application Support/food-recalls-fda-relay/`,
writes `~/Library/LaunchAgents/app.foodrecalls.fda-relay.plist`, loads it, and runs once
right away. Because the relay is copied, branch switches in the repo don't affect it.
Re-run `install` after changing `scripts/fda-relay.mjs`.

```bash
scripts/fda-relay-launchd.sh status
```
This shows the agent's state and the last log lines (`~/Library/Logs/food-recalls-fda-relay.log`).

```bash
scripts/fda-relay-launchd.sh run
```
This runs the relay once in the foreground, which is handy after a long sleep or for a backfill.

macOS asks once whether `security` may read the Keychain item. Choose "Always
Allow" so the background runs don't prompt.

## Uninstall

```bash
scripts/fda-relay-launchd.sh uninstall
```

That unloads and deletes the agent and its copied files. The log and the Keychain
item are kept. The script prints the commands to delete them. Then, on Convex:

```bash
npx convex env remove FDA_RELAY_SECRET --prod
```

With the secret unset the endpoint answers 503. `fda_rss` falls back to Convex's
own fetch only, which is the pre-relay behavior.

## Secret rotation

Generate a new value, set it on Convex (`npx convex env set FDA_RELAY_SECRET … --prod`),
then run `scripts/fda-relay-launchd.sh secret` with the same value. Runs between
the two steps get 401, which doesn't change health, and the next run after both steps succeeds.
