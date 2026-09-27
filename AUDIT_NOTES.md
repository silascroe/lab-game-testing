# Audit notes

## Current verified head

Application code is at `f72b914` (2026-09-27), “Make hub hint verification robust to slow renderers.” GitHub Actions CI run #35 for that commit completed successfully.

## Earlier fixes retained

- Added a real second interaction to explicitly log the chamber seal; reading specimen 44-B alone no longer triggers completion.
- Completion now requires physically leaving containment, after which the bulkhead closes.
- Movement and interaction respect pointer lock and stop behind overlays.
- The Records keypad is a separate physical control. Each digit is sent to the engine, and its display faces the hub.
- Added loading progress and a readable WebGL error state; audio starts after the user's first click.
- The test/debug API is opt-in through `?test=1`.
- Added geometry, sign-visibility, first-person playthrough, and screenshot checks.

## Latest verification: CI run #35

All workflow steps passed on `f72b914`:

- `npm run check`: TypeScript check and production build
- `tools/audit.mjs`: spawn and door-opening geometry
- `tools/sign-audit.mjs`: expected signs visible from approach views
- `tools/playthrough.mjs ... 1`: one full main objective route plus a separate Records keypad route
- `tools/screenshot.mjs`: delivery-view PNG captures uploaded as `site-orpheus-screenshots`

The keypad route rejects `1111`, accepts `7419`, enters Records, and opens a terminal log. The objective route restores both auxiliary buses, reads the specimen record, explicitly logs the seal, and exits containment before the ending state.

## Limits of this verification

CI uses Chromium with SwiftShader; the workflow does not enable the optional hardware-GPU screenshot path. These checks establish that the app builds, interactions and movement complete the scripted routes, and expected signage is visible in the tested views. They do not replace a human visual review on the target GPU.

Older notes about a red CI run, a stalled keypad route, or sprint/crouch checks after the ending were superseded by later commits and the successful run #35.
