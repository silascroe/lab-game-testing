# AGENTS.md — Site Orpheus continuation notes

This repository is the working refinement build of **Site Orpheus**, a first-person Three.js abandoned biotech-lab experience. Treat the repository as the source of truth; do not rely on chat history.

## Product goal

Deliver a compact, polished, explorable facility where the environment is the product. Priorities:

1. Environment quality and spatial coherence
2. Atmosphere and lighting
3. First-person movement and collision
4. Interaction polish
5. Coherent environmental storytelling

Avoid combat, enemies, inventory systems, and large puzzle trees.

## Current state

- Branch: `main`
- Latest application-code commit: `f72b914` — “Make hub hint verification robust to slow renderers”
- GitHub Actions CI run **#35** for that commit completed successfully.
- There are no known failing CI checks at this head.
- The handoff notes and audit summary were refreshed after CI; documentation-only changes are excluded from the workflow triggers.

The experience has an airlock, central hub, main corridor, wet lab, control room, Records/server room, utility room, and containment chamber. The main objective restores AUX BUS A and B, releases containment, lets the player inspect specimen 44-B and explicitly log its seal, then requires them to leave the chamber before the bulkhead closes. Records is an optional route with a physical keypad.

## Latest verification

CI run #35 passed all workflow steps:

- TypeScript check and production Vite build
- Geometry audit for the spawn point and door openings
- Rendered sign-visibility audit from expected approach views
- One real-input first-person objective playthrough
- Separate real-input Records keypad route: rejects `1111`, accepts `7419`, enters Records, and opens a terminal log
- Screenshot capture and upload as the `site-orpheus-screenshots` Actions artifact

The browser checks use Chromium with SwiftShader. The screenshot harness can request a hardware GPU with `ORPHEUS_GPU=1`, but the CI workflow does not set it. The current CI result verifies functionality and captures the scene; it does not establish how the latest build looks on the user's GPU. Human visual acceptance is still useful.

## Recent refinement work

- Repositioned signage and added physical backplates after signs were obscured by architecture.
- Reduced over-bright practical lighting and restrained exposure, fog, bloom, grain, and chromatic aberration.
- Removed duplicate utility transformer geometry and strengthened containment staging.
- Added explicit seal acknowledgement and a physical containment exit beat.
- Made the Records keypad a distinct interaction and fixed the end-to-end route.
- Added geometry, sign visibility, first-person playthrough, and screenshot tooling.

## Important files

- `src/engine/world.ts` — facility layout, props, rooms, doors, lights, and interactions
- `src/engine/Lab.ts` — renderer, input, targeting, progression, and diagnostics
- `src/engine/player.ts` — first-person movement and collision
- `src/engine/props.ts` — procedural props, signs, practical lights, atmosphere
- `src/engine/textures.ts` — canvas-generated material and sign textures
- `src/engine/audio.ts` — synthesized ambience and effects
- `src/engine/postfx.ts` — post-processing
- `src/App.tsx`, `src/ui/Overlays.tsx` — loading, start, HUD, keypad, logs, ending, error state
- `tools/audit.mjs` — doorway and spawn geometry checks
- `tools/sign-audit.mjs` — rendered sign visibility checks
- `tools/playthrough.mjs` — real-input objective and keypad runs
- `tools/screenshot.mjs`, `tools/views-delivery.json` — deterministic review captures
- `.github/workflows/ci.yml` — CI sequence

The world is made from original procedural geometry and canvas textures. No external model or texture pack is required.

## Local workflow

Requirements: Node.js 22+.

```bash
npm ci
npm run check
npm run dev
```

The browser harness dependencies live under `.testkit`. To run the browser checks locally, install them with `npm ci --prefix .testkit` and install Playwright Chromium.

Diagnostic helpers are exposed only when the app is opened with `?test=1`; ordinary visits do not publish the debug API on `window`.

## Next review

Open the deployed build in a normal browser and judge the world visually and by walking it. If the visual result needs work, capture the affected view and fix the scene itself. Do not declare visual success from a green build or structural audit alone. Keep this file current when code, CI status, known limitations, or the next task changes.
