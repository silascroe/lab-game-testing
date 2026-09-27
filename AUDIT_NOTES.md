# Audit notes

## Fixed

- The keypad now sends each digit to the game engine. Previously only the fourth digit was sent, so the visible 7419 sequence could never unlock Records.
- The keypad display now faces the hub, where the player uses it.
- Procedural sound now starts from the initial user click, as required by browser audio policies.
- The browser test hook is opt-in with ?test=1; ordinary visits no longer publish the debug API on window.
- React cleanup now cancels transient keypad/flavor UI timers. The game engine also cancels its progression timers and stops booting cleanly if the component is disposed during initialization.
- Playwright tools resolve their local test dependency instead of relying on an Arena-specific absolute path. Their routes now physically pass through doorways and approach the keypad and terminal within interaction range.

## Verification

- npm run build and npx tsc --noEmit pass.
- The generated-world audit reports all seven door openings clear, the spawn clear, and no browser-console errors.
- Two separate first-person runs completed the power, containment, specimen-log, and ending sequence. Sprint and crouch also passed.
- The keypad check rejected 1111, accepted 7419, reacquired pointer lock, entered Records, and opened a terminal log.

## Cleanup pass

- Added an explicit second interaction at the specimen terminal to log chamber seal 44-B. Reading the final record no longer auto-completes the game on a timer.
- Movement and interaction key handling now respect pointer lock, so the player cannot keep walking behind overlays or after intentionally releasing the mouse.
- The final state now releases pointer lock, hides the live HUD, and leaves the ending card as the only gameplay overlay.
- Added `npm run typecheck`, `npm run check`, and CI that re-runs build, geometry audit, and a first-person playthrough on every push and pull request.
- Removed a no-op React statement and tightened transient flavor-timer cleanup.
