# AGENTS.md — GestureBridge

> 🚨 READ THIS FIRST. Most critical rules are at the top. Do not skip sections.

---

## ⛔ Guardrails & Boundaries (Non-Negotiable)

### 🗂️ Project Structure
- **NEVER modify** `client/`, `server/` (old Vite/Express dirs) — they are legacy and will be deleted
- **NEVER import server-only code** (`lib/db`, `lib/auth`, `lib/socket`, Mongoose models) into `"use client"` components
- **NEVER run `next start`** — always run `node server.ts` (Socket.IO requires a custom server)

### 📦 Package Management
- **NEVER use `yarn` or `pnpm`** — use `npm` and `npx` only
- **NEVER pin dependency versions** in `package.json` — always install with `@latest`
- **NEVER add a new heavy dependency** without checking if a native API or existing lib covers it

### 🎨 Styling
- **USE Tailwind CSS** — utility-first classes only; no vanilla CSS files, no CSS Modules, no styled-components
- Tailwind config lives in `tailwind.config.ts`; extend the theme there instead of writing custom CSS
- For complex animations or one-offs, use `@layer utilities` in `globals.css` — not inline `style={{}}`

### 🌐 Data Fetching & Server State
- **USE TanStack Query (React Query v5)** for all async server state — API calls, caching,
  loading/error/refetch lifecycle. Never manage these manually with `useState` + `useEffect`
- **USE native `fetch`** as the transport layer *inside* `queryFn` / `mutationFn` — no axios, no ky
- **NEVER use `axios`** — TanStack Query + fetch covers every real-world need without the extra bundle
- Server Actions (Next.js) are preferred over REST routes for simple mutations; use `useMutation`
  to wrap them when you need optimistic updates or rollback
- All queries must define a stable `queryKey` array — colocate keys in a `queries.ts` file per feature

### 🤖 MediaPipe & TensorFlow
- **NEVER instantiate `new Hands()` more than once** — the MediaPipe singleton in `useMediaPipe` must be preserved
- **NEVER cross-import TF.js builds** — `@tensorflow/tfjs-node` is server-only; `@tensorflow/tfjs` is browser-only

### 🔐 Security & Config
- **NEVER hardcode secrets or URLs** — use `process.env.*` with fallbacks
- Public env vars (browser-safe) must be prefixed `NEXT_PUBLIC_`; server-only vars must not be

### 🟦 TypeScript
- **NEVER use `any`** without an inline comment explaining why (`// any: third-party lib has no types`)
- Prefer `unknown` + type narrowing over `any`; prefer `satisfies` over casting with `as`

---

## Project Overview

**GestureBridge** is a real-time hand gesture recognition app that lets users control their computer (mouse move, click, scroll) using webcam hand gestures.

**User flows:**
1. Register / Login
2. Collect gesture training samples → `/ml/collect`
3. Import pre-labeled datasets → `/ml/import`
4. Train a TensorFlow.js model on the server → `POST /api/ml/train`
5. Run real-time recognition + OS mouse control → `/recognition`
6. View gesture history → `/history`

**Two independent projects — no shared code:**
- `web/` → Next.js 16 App (merges old `client/` + `server/`)
- `desktop/` → Electron shell (simply loads `http://localhost:3000`)

---

## Tech Stack

### `web/` (Next.js App)

| Technology | Version |
|---|---|
| Next.js (App Router) | latest |
| TypeScript | latest |
| React | latest |
| Mongoose | latest |
| Socket.IO (server + client) | latest |
| TensorFlow.js (browser) | latest (`@tensorflow/tfjs`) |
| TensorFlow.js (server) | latest (`@tensorflow/tfjs-node`) |
| MediaPipe Hands | CDN via `window.Hands` (not bundled) |
| jsonwebtoken | latest |
| bcrypt | latest |
| Node.js | LTS latest |

### `desktop/` (Electron App)

| Technology | Version |
|---|---|
| Electron | latest |
| TypeScript | latest |
| robotjs | latest (requires `electron-rebuild` after install) |
| electron-builder | latest |

---

## Project Map

```
gestureBridge/
├── AGENTS.md               ← Agent reference (this file)
├── TASK.md                 ← Migration task checklist
├── package.json            ← Root scripts only (concurrently)
│
├── web/                    ← Next.js 16 + TypeScript (PRIMARY APP)
│   ├── server.ts           ← Custom server: Next.js + Socket.IO (run this, not next start)
│   ├── next.config.ts
│   ├── tsconfig.json       ← strict: true, paths: { "@/*": ["./*"] }
│   ├── .env.local          ← MONGODB_URI, JWT_SECRET, PORT
│   │
│   ├── app/                ← Next.js App Router
│   │   ├── layout.tsx      ← Root layout: AuthProvider + GestureProvider + Navbar
│   │   ├── page.tsx        ← Landing page (SSR, no "use client")
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├── recognition/page.tsx   ← "use client" (webcam + real-time)
│   │   ├── history/page.tsx       ← "use client"
│   │   ├── ml/
│   │   │   ├── collect/page.tsx   ← "use client" (data collector)
│   │   │   └── import/page.tsx    ← "use client"
│   │   └── api/
│   │       ├── auth/register/route.ts
│   │       ├── auth/login/route.ts
│   │       ├── logs/route.ts
│   │       └── ml/
│   │           ├── status/route.ts
│   │           ├── gestures/route.ts
│   │           ├── gestures/batch/route.ts
│   │           ├── collect/route.ts
│   │           ├── train/route.ts
│   │           └── import/route.ts
│   │
│   ├── components/         ← Shared UI (all .tsx)
│   │   ├── Navbar.tsx
│   │   ├── ProtectedRoute.tsx
│   │   ├── WebcamView.tsx
│   │   ├── ConfidenceBar.tsx
│   │   ├── GestureDisplay.tsx
│   │   └── ModeToggle.tsx
│   │
│   ├── hooks/              ← Custom React hooks (all .ts)
│   │   ├── useMediaPipe.ts ← ⚠️ MediaPipe singleton — do not refactor
│   │   ├── useGestureModel.ts
│   │   ├── useMouseControl.ts
│   │   └── useSocket.ts
│   │
│   ├── context/            ← React context providers (all .tsx, "use client")
│   │   ├── AuthContext.tsx
│   │   └── GestureContext.tsx
│   │
│   ├── lib/                ← Server-only utilities (NEVER import in "use client")
│   │   ├── db.ts           ← MongoDB connect (singleton)
│   │   ├── auth.ts         ← JWT sign/verify + middleware
│   │   └── socket.ts       ← Socket.IO server instance + mouse handler
│   │
│   ├── models/             ← Mongoose models (server-only)
│   │   ├── User.ts
│   │   ├── Gesture.ts
│   │   ├── GestureLog.ts
│   │   └── Sample.ts
│   │
│   └── ml/
│       └── trainer.ts      ← TF.js model training (server-only)
│
└── desktop/                ← Electron shell (TypeScript)
    ├── src/
    │   ├── main.ts         ← Opens BrowserWindow → loadURL("http://localhost:3000")
    │   └── preload.ts      ← contextBridge: exposes window.electronAPI (IPC)
    ├── tsconfig.json       ← module: commonjs (Electron requirement)
    └── electron-builder.yml
```

**Legacy (do not touch):**
```
client/     ← OLD Vite + React (plain JS) — will be deleted
server/     ← OLD Express + Socket.IO (plain JS) — will be deleted
desktop/    ← OLD Electron (plain CJS) — being replaced by new desktop/src/
```

---

## Development Commands

### First-time setup
```bash
# Install dependencies for both projects
cd web && npm install
cd ../desktop && npm install

# Rebuild native modules for Electron
cd desktop && npx electron-rebuild
```

### Run in development
```bash
# Terminal 1 — Start web (Next.js + Socket.IO)
cd web && npm run dev
# → http://localhost:3000

# Terminal 2 — Start desktop (waits for :3000 then opens Electron)
cd desktop && npm run dev
```

### Or run both together from root
```bash
npm run dev
# Uses concurrently to run web + desktop
```

### TypeScript check
```bash
cd web && npx tsc --noEmit
cd desktop && npx tsc --noEmit
```

### Lint
```bash
cd web && npm run lint
```

### Build
```bash
# Web (production build)
cd web && npm run build

# Desktop (package app)
cd desktop && npm run build
```

### Install a new package (always use @latest)
```bash
# In web/
cd web && npm install some-package@latest

# In desktop/
cd desktop && npm install some-package@latest
```

---

## Coding Conventions

### TypeScript

| ✅ Do | ❌ Don't |
|---|---|
| Enable `"strict": true` in all tsconfigs | Disable strict flags for convenience |
| Type all function parameters and return values | Use `any` without a comment |
| Export TypeScript interface alongside Mongoose model | Skip interface definitions |
| Use `unknown` for external data, then validate | Cast directly with `as SomeType` |

### React / Next.js

| ✅ Do | ❌ Don't |
|---|---|
| Add `"use client"` to components that use hooks/browser APIs | Forget `"use client"` on hook-using pages |
| Use `redirect()` from `next/navigation` for server-side redirects | Use `useRouter().push()` in server components |
| Return `NextResponse.json()` from all API route handlers | Return raw `Response` objects |
| Use `@/` alias for all internal imports | Use relative `../../` paths |
| Use functional components with hooks | Use class components |
| Keep pages thin — move logic into hooks and `lib/` | Put business logic directly in page components |

### CSS / Styling

| ✅ Do | ❌ Don't |
|---|---|
| Use Tailwind CSS utility classes | Add styled-components, CSS modules, or inline style objects |
| Extend the theme via `@theme` in `globals.css` | Hardcode arbitrary hex/rgb colors inline |
| Use `@layer utilities` for custom keyframes/animations | Write unorganized vanilla CSS stylesheets |

### API Routes

| ✅ Do | ❌ Don't |
|---|---|
| `return NextResponse.json({ error }, { status: 4xx })` on failure | Throw unhandled errors from route handlers |
| Always call `await connectDB()` at the start of every route | Assume DB is already connected |
| Validate request body before processing | Trust raw `req.body` without checks |

### File Naming

| ✅ Do | ❌ Don't |
|---|---|
| `.ts` for pure logic, `.tsx` for JSX files | Use `.js` or `.jsx` anywhere in `web/` or `desktop/` |
| `PascalCase` for components (`Navbar.tsx`) | Use kebab-case for component files |
| `camelCase` for hooks and utilities (`useSocket.ts`) | Mix naming conventions |

---

## Architecture Reference

### Why a custom `server.ts`?
Next.js Route Handlers are stateless — they cannot hold WebSocket connections. Socket.IO (used for real-time mouse control) must attach to the same HTTP server as Next.js. The pattern:
```
node server.ts  →  creates HTTP server  →  Next.js handles requests + Socket.IO handles WS
```

### Why two separate projects?
`desktop/` is a **pure Electron shell** — it has zero code dependency on `web/`. It simply opens `http://localhost:3000` in a BrowserWindow. This keeps both projects independently deployable and testable.

### Gesture → OS Control Flow
```
Webcam → MediaPipe (browser) → landmarks → Socket.IO event → server.ts → robotjs → OS mouse/click
```

### MediaPipe Landmark Key Indices
```
0 = wrist      4 = thumb tip    8 = index tip
12 = middle tip   16 = ring tip    20 = pinky tip
```
**Y-axis**: increases downward. Finger "up" = `tip.y < pip.y`

### Default Gesture Label Indices
```
0: Pointing   1: Fist   2: Peace   3: Open Palm   4: Rock   5: Thumb
```
⚠️ These indices must stay aligned with the trained TF.js model. Adding gestures without retraining causes misclassification.

### Electron IPC Channels
```
mouse:move   → { x, y }             → robotjs.moveMouse()
mouse:click  → { button }           → robotjs.mouseClick()
mouse:scroll → { direction }        → robotjs.scrollMouse()
screen:size  → (invoke, no payload) → returns { width, height }
```
All exposed via `window.electronAPI` through `preload.ts` contextBridge.

---

## Environment Variables

### `web/.env.local`
```
MONGODB_URI=mongodb://localhost:27017/gesturebridge
JWT_SECRET=your_secret_here
PORT=3000
NODE_ENV=development
```

### `desktop/` (optional `.env`)
```
WEB_URL=http://localhost:3000
```

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
