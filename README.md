# RWEB — Rust WASM Particle Portfolio

[![Build static site](https://github.com/ovws/rweb/actions/workflows/build.yml/badge.svg)](https://github.com/ovws/rweb/actions/workflows/build.yml)

A **pure static personal homepage** and browser compute benchmark built with Vite, TypeScript, Three.js, Rust, WebAssembly, `wasm-bindgen` / `wasm-pack`, and Web Worker + OffscreenCanvas.

The visual layer is a large real-time 3D particle field. The benchmark lets the same simulation run in either optimized JavaScript or Rust/WASM so the difference is measured rather than staged.

## What it tests

- 10K / 50K / 100K / 200K particles
- velocity + acceleration integration
- trigonometric noise field
- 3D spatial hash rebuild every simulation frame
- 27-cell neighbour search with the same 48-candidate cap in JS and Rust
- local repulsion and network-edge calculation
- pointer attraction / `Alt` repulsion
- click ripple and impulse explosion
- sphere / torus / wave morph targets
- live FPS, frame time, simulation time, particle count and network edge count

## Architecture

```text
Main thread
  ├─ portfolio DOM / navigation / benchmark controls
  └─ sends pointer + settings only
             │
             ▼
Web Worker + OffscreenCanvas
  ├─ Three.js renderer (rendering only)
  ├─ JavaScript simulation (TypedArray)
  └─ Rust/WASM simulation
       └─ Three.js BufferAttribute reads a Float32Array view over WebAssembly.Memory
```

For the WASM engine, the renderer and WASM simulation live in the same Worker. The Three.js position buffer points at a `Float32Array` view of `WebAssembly.Memory`, avoiding a full Worker→main particle-position copy every frame. If WASM memory ever grows, the view is rebound automatically.

## Fair benchmark rules

The JavaScript and Rust implementations intentionally mirror each other:

- same deterministic LCG seed (`0x51f15e`)
- same initial particle distribution
- same timestep clamp
- same force constants
- same spatial-hash cell size and table size
- same 27 neighbouring cells
- same maximum 48 neighbour candidates per particle
- same morph math and event forces
- simulation time is measured around `step()` in the same Worker; Three.js rendering is outside that timing
- switching engines resets both implementations to the same deterministic initial state before measurement

The JavaScript path uses preallocated typed arrays and integer hashing. It is not deliberately de-optimized.

## Local development

### Requirements

- Node.js 20+ (22 recommended)
- npm
- Rust stable + `wasm32-unknown-unknown` target for the Rust engine
- `wasm-pack`

Install Rust/WASM tooling:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
```

Then:

```bash
npm install
npm run dev
```

### Production build

```bash
npm install
npm run build
```

`npm run build` first runs `scripts/build-wasm.mjs`:

- if `wasm-pack` exists, it compiles the real release-mode Rust bundle into `public/wasm/`;
- if `wasm-pack` is unavailable, the build still succeeds with a runtime JS fallback so the static portfolio never becomes a blank/grey screen.

The final static output is `dist/`.

To explicitly compile only WASM:

```bash
npm run wasm:build
```

## Interaction

- move pointer: attract particles
- hold `Alt` while moving: repel particles
- click the particle field: ripple
- **Trigger impulse**: explosion force
- **Morph field**: sphere → torus → wave
- **Benchmark**: switch JS/Rust WASM and particle counts live

## Fallback behaviour

The homepage is independent from the compute layer. If WebGL, Worker, OffscreenCanvas, or WASM initialization fails, the particle canvas is replaced with a lightweight CSS fallback visual while all Home / About / Projects / Skills / Contact content remains usable.

If only WASM fails, the worker automatically selects the JavaScript engine and reports the reason in the benchmark panel.

## Static deployment

The Vite base is relative (`./`), so the generated `dist/` can be served from a root domain or a sub-path.

### Vercel

- Framework preset: **Vite** or **Other**
- Build command: `npm run build`
- Output directory: `dist`
- Ensure the build environment has Rust + `wasm-pack` if you want the WASM engine compiled there. Otherwise commit a locally built `public/wasm/` bundle or add equivalent install steps.

### Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: 22 recommended
- Install Rust + `wasm-pack` in the build environment, or build the WASM bundle before deployment.

### GitHub Pages

Build `dist/` in GitHub Actions and upload it with the official Pages actions. The relative Vite base also supports repository sub-path hosting such as `/rweb/`.

## CI verification

`.github/workflows/build.yml` installs Node, Rust, the WASM target, and `wasm-pack`, then runs:

```bash
npm install --no-audit --no-fund
npm run build
```

This ensures GitHub verifies the **real Rust/WASM build**, not only the JavaScript fallback path.

## Performance notes

Results vary heavily by CPU, browser, thermal state, WebGL driver and selected particle count. Use the same browser tab, particle count and interaction state when comparing engines. At 100K–200K particles the simulation deliberately becomes CPU-heavy; that is the intended stress-test range.

## Project structure

```text
src/
  engine/
    js-simulation.ts     # optimized JS reference implementation
    protocol.ts          # Worker message types
  workers/
    simulation.worker.ts # Three.js + JS/WASM simulation worker
  main.ts                # portfolio UI and benchmark controls
  styles.css
wasm/
  Cargo.toml
  src/lib.rs             # Rust simulation
scripts/
  build-wasm.mjs         # compile WASM or create safe fallback
.github/workflows/
  build.yml              # real Rust/WASM CI build
```

## License

MIT
