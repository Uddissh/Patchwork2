# PATCHWORK — Frontend

React (Vite) + Tailwind CSS frontend for **PATCHWORK**, the AI platform that assembles
supplier networks for customer orders.

Design language: **Warm Industrial Editorial × Premium Operations Software** — limestone
and paper surfaces, carbon ink, forest green as the working accent, oxide orange reserved
for operational risk. One dark surface: the network canvas, a warm "operations room"
inset in the light editorial page. Typography: Fraunces (display) · Instrument Sans (UI)
· IBM Plex Mono (data). Motion: **Anime.js v4** as the sole animation engine, scoped per
view and fully reverted on unmount.

## Quick start

```bash
npm install
npm run dev        # → http://localhost:5173
```

The backend URL is read from `VITE_API_URL` (see `.env`), defaulting to
`http://localhost:8000`.

For local visual QA without a real backend, `scripts/mock-backend.mjs` serves the
documented API contracts with deterministic fixtures (`node scripts/mock-backend.mjs`),
and `scripts/capture.mjs` drives headless Chrome over CDP to screenshot every screen
(`node scripts/capture.mjs after` → `shots/after/`). Both are verification harnesses,
not part of the app.

## Flow

1. **Request** — describe the order (+ budget / deadline / quantity).
   `POST /decompose` turns it into pipeline stages, then `POST /assemble`
   builds the supplier network.
2. **Network** — the signature canvas. On assembly, stage chips, node tiers
   (staggered per supply tier) and **self-drawing SVG connections** land on a
   single Anime.js timeline (click the canvas to skip). **Simulate Failure**
   flags a supplier, degrades downstream routes with a staggered per-hop
   warning ripple, calls `POST /repair`, unplugs the failed node's links,
   slots a replacement into the exact coordinates, redraws its links and
   tweens the total. **Proceed to Checkout** continues to payment.
3. **Checkout** — ledger-style summary with tweened currency counters.
   **Pay with PayPal** calls `POST /checkout`, saves the network to
   `sessionStorage`, and redirects to the returned `approval_url`. On return
   with `?order_id=` in the URL, the app automatically calls
   `POST /checkout/capture` and shows the success screen (stroke-drawn
   confirmation + order summary).
4. `GET /health` backs the **Test Connection** button (also auto-checked on load).

## Endpoints used

| Method | Path                | Purpose                              |
| ------ | ------------------- | ------------------------------------ |
| GET    | `/health`           | Connection check                     |
| POST   | `/decompose`        | Request brief → pipeline stages      |
| POST   | `/assemble`         | Stages → supplier network            |
| POST   | `/repair`           | Failed supplier → replacement        |
| POST   | `/checkout`         | Create PayPal order → `approval_url` |
| POST   | `/checkout/capture` | Capture the approved PayPal order    |

The API client (`src/api.js`) and the normalizers (`src/lib/normalize.js`)
tolerate a range of response shapes — e.g. suppliers under `nodes`, `suppliers`,
`network`, or an object keyed by stage; fields like `price`/`cost`/`unit_price`,
`days`/`delivery_days`/`lead_time`, and PayPal approval URLs at the top level or
inside `links: [{ rel: 'approve', href }]`.

## Design tokens (`src/index.css`)

| Role | Token | Value |
| ---- | ----- | ----- |
| Page / documents | `limestone / paper` | `#F2F0E9 · #FBFAF6` |
| Operations canvas | `canvas` (the only dark surface) | `#1F241F` |
| Ink & text | `ink / secondary / faint` | `#202622 · #657069 · #98A097` |
| Lines | `line / line-soft` | `#D8D8CF · #E8E6DD` |
| Working accents | `forest (actions, nominal) · oxide (risk actions)` | `#31594D · #BF6243` |
| State | `moss / amber / brick` | `#3E7A62 · #B08A3E · #A94438` |

Radii are 2px, rules are 1px hairlines (totals get a double rule, accounting style),
numerals are IBM Plex Mono with `tabular-nums`, display headings are Fraunces, UI is
Instrument Sans. Stage identity is structural (mono index + label, rendered as canvas
lanes). Colour is discipline: forest acts, oxide warns, moss/amber/brick are states.
All motion respects `prefers-reduced-motion`.

## Motion architecture (Anime.js v4)

- `src/lib/motion.js` — duration/ease tokens plus the primitives: SVG edge
  `edgeDrawIn`/`edgeUnplug` (dasharray technique, honours live path lengths),
  `tweenMoney` (imperative counter on a DOM ref — zero re-renders/frame) and
  `reducedMotion()`.
- `src/lib/useMotionScope.js` — React bridge: creates an Anime.js `createScope`
  rooted at the view, registers every timeline/animation, and `scope.revert()`
  in cleanup. No orphaned animations, no DOM desync.
- React Flow safety: Anime.js only touches custom-node card contents and the
  custom edge's own `<path>` (`src/components/flow/AnimatedEdge.jsx`) — never
  the React Flow viewport or node wrappers. Node positions are deterministic
  (stage/slot), so replacements land on the victim's exact coordinates.
- Integrity: animations track real state and real API responses; loading
  indicators are honest (never fake progress). The failure sequence has a
  short display floor so states stay readable.

## Project structure

```
src/
  api.js                  axios instance + endpoint wrappers
  App.jsx                 view routing, PayPal return handling, toasts
  index.css               design tokens, composites, React Flow theme
  components/
    RequestView.jsx       View 1 — request form + health check
    NetworkView.jsx       View 2 — assembly timeline, failure/reroute choreography
    CheckoutView.jsx      View 3 — ledger + PayPal payment
    SuccessView.jsx       capture confirmation + order summary
    ErrorBoundary.jsx     render-fault recovery panel
    Header.jsx / Toast.jsx / Icons.jsx
    flow/
      SupplierNode.jsx    custom node card (paper spec label, state spine)
      LaneNode.jsx        stage lane band per supply tier
      AnimatedEdge.jsx    custom edge — self-drawing SVG routes, hover focus
  lib/
    normalize.js          response normalizers, money + end-to-end lead helpers
    motion.js             Anime.js tokens + draw/unplug/counter primitives
    useMotionScope.js     createScope ⇄ React lifecycle bridge
    ui.js                 stage tag helper
```
