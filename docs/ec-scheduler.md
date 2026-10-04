# EC Scheduler

After reaching Reality, open **Challenges → Eternity Challenges → EC Scheduler**. Enable the desired ECs, choose target completions, and press **Start / Resume**. Targets are minimums: ECB may award additional tiers in the same Eternity.

The first release supports EC1–12 in ordinary Reality progression. It uses normal study, purchase, Crunch, and Eternity APIs; it never grants rewards directly. It does not complete Reality resets or run inside celestial challenges, other special modes, or Dilation. Configure the existing Dimension, Tickspeed, Dimension Boost, and Galaxy autobuyers for progression and enable their master switch.

## Behavior

- Checks prerequisites and costs from the current game state. Study 62 is optional until EC5 or its bypass perk is available. EC10–12 wait for their Study 181 and later prerequisites.
- Selects inexpensive incomplete tiers, prepares a route, and respecs incompatible studies through an actual Eternity. Only confirmed challenge entry transitions to the running state.
- Claims a single tier without ECB. With ECB, briefly waits for additional tiers, then claims available progress. EC4/12 claims happen immediately because their restrictions can invalidate progress.
- Uses the actual Infinity budget in EC4. EC8 seeds ID1 once, reserves remaining purchases for ID8, and splits Replicanti purchases between chance, interval, and Galaxy cap. Resuming reads purchases already spent from the game state.
- Defers unsuccessful attempts with exponential cooldowns, tries another eligible challenge, or farms EP and TT. Completion, perk, upgrade, glyph, and Overclock changes invalidate retry cooldowns. An overall budget ends sessions without further completions.
- Shows current activity, per-EC reasons, and the most recent 12 events. Advanced controls accept custom normal-study routes (no EC suffix) and EC8 purchase allocations.

Balanced uses 30 seconds without meaningful resource progress, a 180-second preparation/run limit, and a 300-second budget without another completion. Fast uses 12, 45, and 90 seconds respectively. These watchdogs use unaccelerated active time; individual coarse offline updates count for at most 250 ms. EC12's actual game-time limit is always enforced by the existing challenge code. Coarse ticks and an insufficient build can still fail it; the scheduler defers the attempt rather than granting a completion or looping endlessly.

The scheduler temporarily intercepts conflicting autobuyer ticks and Automator updates. Their saved settings and script position are preserved. It does not alter Overclock settings. Pause/Stop releases control and leaves the current challenge intact, so any enabled prestige autobuyer or suspended Automator can act again. Starting or stepping the Automator explicitly pauses the scheduler. Manual study changes, prestiges, and unsupported modes also pause it. Configuration survives reload; an active session loads paused and resumes by inspecting the live state.

## Implementation and validation

The controller is `src/core/ec-scheduler.js`; `ECSchedulerPanel.vue` provides controls. `player.ecScheduler` supplies defaults through the normal save merge. The controller ticks after production and coordinates with `Autobuyers` and `AutomatorBackend`. Owned challenge failures go to its activity log instead of repeated modal dialogs; other failures retain their existing behavior.

To run the integration checks, install dependencies with `npm ci`, start the development server at port 8080, and run:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:ec-scheduler
```

Set `SCHEDULER_TEST_URL` to test a served production build. The test creates an isolated browser profile and constructed game states; it does not touch a user's browser save. Checks cover real entry/reward APIs, single and bulk completions, partial claims, prerequisites, respec recovery, refusal/stall recovery, EC4/8/12 restrictions, coarse ticks, Overclock changes, automation ownership, manual intervention, legacy saves, reload, and visible controls.

Strategies were seeded from the four user-supplied Ninja progression scripts and checked against the upstream [Automator reference](https://github.com/IvarK/AntimatterDimensionsSourceCode/blob/master/src/core/secret-formula/reality/automator.js) and this mod's study/challenge code. The Fandom Automator, Eternity Challenges, and Guide pages and their raw/API forms were retried after network access changed; they returned HTTP 402 with “Please contact the site owner for access.” No inaccessible wiki strategy is claimed as verified.
