# Site Orpheus

A compact first-person Three.js environment set inside a decommissioned underground biotech facility. The build is intentionally environment-first: movement, spatial coherence, lighting, procedural materials, audio, signage, and environmental storytelling matter more than adding game systems for their own sake.

The current route starts in the decontamination airlock, opens into a damaged central hub, and branches into the wet lab, records/server room, utility room, control room, and containment chamber. The light objective is to restore both auxiliary buses, release the containment interlock, inspect specimen 44-B, and log the chamber seal.

## Run locally

Requirements: Node.js 22+.

```bash
npm ci
npm run dev
```

Vite prints the local URL. Click **Enter the facility** to acquire pointer lock.

Controls: **WASD** move, **mouse** look, **Shift** sprint, **C** crouch, **E** interact, **Esc** releases the mouse.

Production verification:

```bash
npm run check
npm run preview
```

`npm run check` performs a TypeScript check and production build. The GitHub Actions workflow also launches Chromium, runs the geometry audit, performs a first-person playthrough, and captures a visual-review screenshot set as a workflow artifact.

## Technical notes

The scene is built from original procedural geometry and canvas-generated textures; no external model or texture pack is required. Three.js handles rendering and post-processing, React provides the lightweight interface, and the Web Audio API synthesizes the facility ambience at runtime.

Quality is selected automatically. Add `?quality=low` for the reduced-effects path or `?quality=high` to force the full render path. `?dpr=1` can be useful when profiling fill-rate-heavy hardware.

## Design priorities

The facility is deliberately small enough to receive attention room by room. Each zone has a distinct operational identity and lighting language instead of being a repeated corridor kit. Environmental text is kept short and diegetic. The main narrative beats are carried by the damaged observation area, dead grid, procedural signage, specimen chamber, abandoned workspaces, and the order in which systems return to life.

## Verification tooling

- `tools/audit.mjs` checks geometry/doorway assumptions.
- `tools/playthrough.mjs` drives a real first-person route through the objective chain.
- `tools/screenshot.mjs` captures fixed review angles with the actual renderer.
- `tools/views-delivery.json` defines the current delivery screenshots.
- CI uploads the latest screenshot set as **site-orpheus-screenshots**.

This repository is the independent refinement build derived from the Site Orpheus prototype, with visual composition and interaction changes made against real play screenshots rather than code inspection alone.
