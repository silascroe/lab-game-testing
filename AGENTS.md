# AGENTS.md — Site Orpheus continuation notes

This repository is the working refinement build of **Site Orpheus**, a first-person Three.js abandoned biotech-lab experience.

Treat the repository itself as the source of truth. Do not depend on chat history to understand the project.

## Product goal

Deliver a compact, polished, explorable first-person environment where the environment is the product. Priorities, in order:

1. environment quality and spatial coherence
2. atmosphere and lighting
3. first-person movement and collision
4. interaction polish
5. coherent environmental storytelling

Avoid feature creep into combat, inventory systems, enemies, or large puzzle trees.

## Current state

Current working branch: `main`.

As of the current head:

- TypeScript check passes.
- Production Vite build passes.
- Doorway geometry audit passes.
- The main objective route passes end-to-end:
  - spawn in airlock
  - enter central hub
  - reach utility room
  - restore AUX BUS A and AUX BUS B
  - return to containment
  - inspect specimen 44-B
  - explicitly log the chamber seal
  - ending state appears
- The rendered sign visibility audit passes the expected approach views.
- No browser console errors were reported in the latest full CI run before the remaining test failures.

The current CI is **not fully green**. The failures are concentrated in the secondary automated checks, not the main objective path.

## Known issues to fix next

### 1. Records/keypad route automation

The optional records-room test currently gets stuck near the keypad/door approach. It times out close to the records doorway and then cascades into failures for:

- opening the keypad overlay
- wrong-code rejection verification
- walking through the unlocked records door
- reaching a records terminal
- opening the records log

Do not assume this is purely a test-harness bug. Inspect the actual geometry, interactable anchor, collision, and prompt acquisition around the records door/keypad.

The last logged timeout was roughly around `(-0.94, 5.52)`, about 1 meter from the keypad approach target.

### 2. Sprint/crouch assertions happen after completion

The automated playthrough currently tests sprint and crouch after the ending has already fired and the gameplay HUD/input is blocked. Those checks report false even though the movement system itself is functional.

Move those control checks earlier in the playthrough, before the final seal/ending interaction.

### 3. Continue visual inspection, not only structural testing

A previous real-player failure showed signage textures existed but were visually buried behind wall/door/pipe geometry. That is why the project now includes rendered sign visibility checks.

When changing signage, lighting, props, or architecture:

- inspect actual rendered views
- prefer physical/credible placement fixes over depth-test hacks
- do not make signs render through walls
- keep text readable without making the environment look like a UI demo

## Visual changes already made

Recent refinement work includes:

- physical backplates for wall signs
- containment and lift signage moved onto clear wall areas
- duplicate wayfinding plaques removed
- sign text constrained to the sign face
- fluorescent practicals and several hot lights reduced
- global exposure and ambient fill reduced
- bloom, grain, chromatic aberration, and fog made more restrained
- soft-shadow mapping enabled
- duplicate utility transformer geometry removed
- observation/power-up staging strengthened

Do not blindly undo these changes without checking the rendered result.

## Important files

- `src/engine/world.ts` — facility layout, props, rooms, doors, lights, interactables, progression wiring
- `src/engine/Lab.ts` — renderer, player integration, input, interaction targeting, progression state, diagnostics
- `src/engine/player.ts` — first-person movement and collision
- `src/engine/props.ts` — reusable procedural props, signage, practical lights, atmosphere helpers
- `src/engine/textures.ts` — procedural/canvas textures and sign rendering
- `src/engine/postfx.ts` — post-processing and grade
- `src/engine/audio.ts` — synthesized ambience and effects
- `src/App.tsx` — React UI state and overlays
- `tools/audit.mjs` — geometry/doorway audit
- `tools/sign-audit.mjs` — rendered sign visibility audit
- `tools/playthrough.mjs` — automated first-person gameplay route
- `tools/screenshot.mjs` — deterministic screenshot capture
- `tools/views-delivery.json` — delivery/review viewpoints
- `.github/workflows/ci.yml` — CI verification sequence

## Local workflow

Requirements: Node.js 22+.

```bash
npm ci
npm run check
npm run dev
```

For a production-like local run:

```bash
npm run build
npm run preview -- --host 127.0.0.1
```

The test harness uses Playwright dependencies under `.testkit`.

If running the full browser checks locally, install them first:

```bash
npm ci --prefix .testkit
npx --prefix .testkit playwright install chromium
```

Then run the preview server and execute the audit tools against the printed URL.

## Working style

Make small, inspectable commits. After meaningful changes:

1. type-check/build
2. run the geometry audit
3. run the sign audit if layout/signage changed
4. run the first-person playthrough
5. inspect screenshots or the live browser for visual changes

Do not declare success because the build is green. This is a visual interactive project; rendered inspection matters.

If a future agent has access only to GitHub, GitHub plus Actions is sufficient to continue. A local/remote machine is useful for direct browser play and faster iteration, but it is not required to understand or edit the project.

## Handoff rule

Before leaving the project in a partially finished state, update this file with:

- latest known-good commit
- what was changed
- what still fails
- exact test/log evidence
- the next recommended action

That keeps continuation independent of any particular ChatGPT conversation, branch, or tool session.
