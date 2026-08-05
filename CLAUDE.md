# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this project is

**El Olimpo** is a digital recreation of a board game described (but never physically
published) in a Spanish book from 1891. It is a single-page TypeScript app: a circular,
ring-based board with a rules engine, a minimax AI, and a 3D renderer, built by Vite into
one self-contained `index.html` that runs by double-clicking it from `file://`.

The game is Spanish-language throughout: UI, comments, docs and test names are written in
rioplatense Spanish. See `reglas-el-olimpo.md` for the full rules and `transcripcion-original*.pdf`
for the 1891 source text.

## ⚠️ Read this first: the repo is currently a flat dump, not a working tree

The single commit (`8c5758d "Add files via upload"`) uploaded files **flattened into the repo
root**, and the TypeScript sources were **not** included. Concretely:

- There is **no `src/` directory**, even though `tsconfig.json` has `"include": ["src", "tests"]`
  and every test imports from `../src/engine/*`.
- There is **no `tests/` directory** — `*.test.ts` and `helpers.ts` sit at the root but import
  `../src/engine/...` and `./helpers`, i.e. they were written to live *inside* `tests/`.
- `index.html` at the root is **not a source file**: it is the 625 KB minified
  `vite-plugin-singlefile` build output, with JS, CSS, the AI worker and `reglas-el-olimpo.md`
  all inlined.
- There is no `.gitignore`, so `node_modules/` shows up as untracked after `npm install`.
  Stage files explicitly; never `git add -A`.

Current, verified state of the commands:

```
npm test        # FAILS: 3 suites fail to collect — "Failed to load url ../src/engine/board"
npx tsc --noEmit # FAILS: TS18003 "No inputs were found in config file"
npm run build   # cannot succeed (tsc step fails; nothing to bundle)
npm run dev     # serves the built index.html, not a source entry point
```

**Do not report the build or tests as passing, and do not "fix" the failures by deleting the
tests or loosening `tsconfig.json`.** The tests and config are correct; the sources are
missing. If a task requires running the engine, the realistic options are:

1. Ask the user for the missing `src/` (most likely — it exists somewhere, this repo is a
   partial upload), or
2. Restore the layout by reconstructing `src/engine/*` from the API contract below (the
   minified logic is recoverable from `index.html`, which contains the whole engine), and
   move `helpers.ts` + `*.test.ts` into `tests/`.

Either way, state plainly which one you did.

## Tooling

Vite 6 + TypeScript 5.6 (strict, `noUnusedLocals`, ESM only) + Vitest 2 + three.js 0.185.
No linter, no formatter, no CI config in the repo.

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server on port 5173 (`strictPort`) |
| `npm run build` | `tsc --noEmit` then `vite build` → one self-contained `dist/index.html` |
| `npm run preview` | Serve the build |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest` in watch mode |

`vite.config.ts` sets `base: './'` and uses `viteSingleFile()` deliberately: the deliverable is
one HTML file that works offline from the filesystem. **Keep it that way** — do not add
external asset references, CDN links, or code-splitting that breaks the single-file output.

## Intended source layout

Reconstructed from the imports in the test files and the footer text in the built HTML:

```
src/engine/types.ts   GameOptions, GameState, Owner, Piece, PieceType
src/engine/board.ts   ring topology + geometry helpers (pure, no game state)
src/engine/setup.ts   initialPieces(), newGame()
src/engine/rules.ts   legal-move generation and selection rules
src/engine/apply.ts   state mutation, end-of-game evaluation, scoring
src/engine/ai.ts      minimax + evaluation (also compiled into the web worker)
src/…                 UI layer: menu, HUD, 3D board, sound, rules modal
tests/helpers.ts      piece() / makeState() factories
tests/*.test.ts       board.test.ts, rules.test.ts, ai.test.ts
diseno/               board/piece redesign assets (referenced by the app footer)
```

## Engine API contract

Anything that reimplements or restores the engine must satisfy these signatures — the test
suite is the spec.

```ts
// board.ts — pure topology
NUM_RINGS: 7
RING_SIZES: [6, 12, 24, 24, 24, 24, 12]   // 126 cells total
REGIONES = 0, TIEMPO = 1, AVERNO = 6      // rings 2–5 are the four Pasiones
lateral(cell, delta): Cell                 // wraps around the ring
radialStep(cell, dir): Cell[]              // [] at the inner/outer edge; may branch
radialReach(cell, dir, n): Cell[]          // accumulates intermediate cells, branches on expansion
diagonalStep(cell, dir): Cell[]

// setup.ts
initialPieces(): Piece[]                   // 36 pieces, 18 per side
newGame(options: GameOptions): GameState

// rules.ts
pieceDests(state, piece): { ring, idx, capture }[]
allMoves(state, owner): Move[]
canSelect(state, piece, owner): boolean
isCellThreatened(state, cell, byOwner?): boolean
cangeoOptions(state, owner): { combo: 'ID+CU' | '2CU+PO'; sacrificeIds: number[] }[]

// apply.ts
applyMove(state, move, quiet?): void       // mutates; `quiet` is used by the AI search
cloneState(state): GameState
evaluateEnd(state): Result | null
regionCounts(state): { rojo: number; dorado: number }
scoreByRegions(state): Result

// ai.ts
bestMove(state, depth, rng): Move | null   // rng breaks ties among equal-scoring moves
evaluate(state, owner): number
```

Shapes:

```ts
Owner   = 'rojo' | 'dorado'
Piece   = { id, type, owner, ring, idx, alive, home: { ring, idx } }
Move    = { kind: 'move'; pieceId; to: { ring, idx } }
        | { kind: 'cangeo'; combo; sacrificeIds }
Result  = { type: 'eliminacion'; winner }
        | { type: 'regiones'; winner: Owner | null; rojo: number; dorado: number }
GameState = { pieces, turn, options: { virtudRival }, cangeoUsado: { rojo, dorado }, history, result }
```

## Domain model — get these right

Piece type codes (`PieceType`) and their display names:

| Code | Name | Per side | Movement |
|---|---|---|---|
| `DI` | Divinidad | — | Neutral centre cell; immobile, uncapturable, **not** in `initialPieces()` |
| `VI` | Virtud | 3 | 1 cell any direction, **only within Regiones + Tiempo**; never captures |
| `ID` | Ídolo | 3 | 2 radial / 3 lateral; captures; cannot enter the Averno |
| `PO` | Pontífice | 3 | 1 radial / 2 lateral; captures |
| `PU` | Pueblo | 2 | 1 straight to empty cells only; captures in **any** direction |
| `CU` | Cura | 6 | 1 diagonal only; moves or captures |
| `DB` | Diablo | 1 | 3 radial / 4 lateral; only 2/2 inside the Averno; the only piece allowed in the Averno |

Board invariants worth keeping in mind:

- 7 rings, 126 cells: Regiones (6) → Tiempo (12) → four Pasiones rings (24 each) → Averno (12).
- Radial moves **branch** where a ring expands (6→12, 12→24, 12→24 outward) and **contract**
  going inward (24→12→6); `radialStep` returns an array precisely because of this.
- Starting position: each side occupies one half of the board (`idx < RING_SIZES[ring] / 2` is
  rojo). `DB` starts in the Averno, `VI` in Tiempo, `ID` in ring 4, and `PO`/`PU`/`CU` in ring 5.
- `reglas-el-olimpo.md` says "37 pieces"; that counts the Divinidad, which the engine models as
  board geometry, not a `Piece`. 36 is correct for `initialPieces()`.

Two rules that are easy to break:

- **`virtudRival`** (game option, on by default): you may move the *opponent's* Virtud when it is
  threatened, to save it. `canSelect` must allow it only when the Virtud is actually threatened
  and only when the option is enabled.
- **`cangeo`**: once per player per game, a dead Diablo can be revived on its `home` cell by
  sacrificing `ID+CU` or `2CU+PO`. Not offered if the Diablo is alive, if `cangeoUsado[owner]`
  is set, or if the home cell is occupied.

Game ends by `eliminacion` (a side loses every piece) or by `regiones` (region count when a
player has no legal moves, or when the player presses "Terminar y contar"). Equal counts → draw
(`winner: null`).

## Runtime behaviour of the app

Facts verified against the built bundle — preserve them when touching the UI:

- Two modes: `ai` (human plays rojo) and `hotseat`. AI difficulty 1/2/3 maps directly to the
  minimax **search depth**.
- The AI runs in an **inlined web worker** and communicates with `postMessage({ state, depth })`,
  replying with the chosen move. Keep it off the main thread — depth 2 from the opening is
  expected to answer in well under 5 s (asserted in `ai.test.ts`).
- Two board styles: `lamina` (the 1891 plate) and `moderno` (coloured rings), rendered with
  three.js (`OrbitControls` + `Raycaster` for picking).
- Sound is synthesised with the WebAudio API — no audio files.
- `localStorage` keys: `el-olimpo-partida` (saved game), `el-olimpo-estilo` (board style),
  `el-olimpo-mute`. All reads are wrapped in try/catch because `file://` can deny storage.
- `window.__olimpo` exposes `{ state, selected, dests, mode, difficulty, thinking, board, fn }`
  for debugging from the console — handy for inspecting behaviour without a rebuild.
- Key DOM ids: `menu`, `game`, `boardWrap`, `hud`, `turnPill`, `regRojo`/`regDorado`, `history`,
  `btnCangeo`, `btnScore`, `btnRules`, `btnSound`, `btnMenu`, `btnContinue`, `rulesModal`,
  `boardStyle`, `difficulty`, `optVirtudRival`.

## Conventions

- **Language.** All user-facing strings, code comments and test descriptions are in rioplatense
  Spanish ("Cangear el Diablo", "¿Confirmás?"). Match it. Identifiers mix English structure with
  Spanish domain nouns — keep the domain vocabulary in Spanish and untranslated: `Regiones`,
  `Tiempo`, `Pasiones`, `Averno`, `Virtud`, `cangeo`, `rojo`, `dorado`.
- **Purity.** `board.ts` is pure geometry with no game state; `rules.ts` reads state and never
  mutates it; only `apply.ts` mutates. Keep that separation — the AI clones states and relies on it.
- **Tests are the rules spec.** The 1891 text is ambiguous in places and the test suite encodes
  the chosen readings (e.g. Regiones as a single shared set of 6 cells). If a rule change is
  requested, change the tests deliberately and say so — don't quietly relax an assertion.
- **Fidelity.** This is a historical reconstruction. When the source text is ambiguous, note the
  interpretation in `reglas-el-olimpo.md` rather than inventing a rule silently.

## File inventory

| File | Notes |
|---|---|
| `index.html` | Built single-file app (minified). Not a source file; do not hand-edit. |
| `el_olimpo_juego.html` | Earlier standalone 2D-canvas prototype, self-contained, superseded. |
| `reglas-el-olimpo.md` | Plain-language rules; inlined into the app's rules modal at build time. |
| `transcripcion-original.pdf`, `-v2.pdf` | Transcriptions of the 1891 source (pp. 318–344). |
| `el-olimpo-rediseno.{svg,png,pdf}` | Board/piece redesign assets. |
| `drive-download-…zip` | The original upload; contains the same docs plus two earlier builds. |
| `helpers.ts`, `*.test.ts` | Test suite — belongs in `tests/`, currently at the root. |
