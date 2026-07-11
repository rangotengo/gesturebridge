# TASK.md — GestureBridge Migration Checklist

> **Goal**: Migrate from Vite+Express (plain JS) → Next.js 15 + TypeScript (`web/`) + Electron TypeScript (`desktop/`).
> Update this file as you progress. Use `[/]` for in-progress, `[x]` for done.

---

## Phase 0 — Root Scaffold

- [x] Update root `package.json` with `dev:web`, `dev:desktop`, `dev` (concurrently), `install:all` scripts
- [x] Verify `concurrently` is installed in root `devDependencies`

---

## Phase 1 — Next.js Web App (`web/`)

### 1.1 Project Bootstrap
- [x] Scaffold: `npx create-next-app@latest web --typescript --app --no-tailwind --import-alias "@/*"`
- [x] Remove default boilerplate (default `page.tsx` content, `globals.css` reset, placeholder components)
- [x] Configure `tsconfig.json` — ensure `"strict": true` and `"@/*"` path alias
- [x] Create `web/.env.local` with `MONGODB_URI`, `JWT_SECRET`, `PORT=3000`

### 1.2 Server-side Libraries (`web/lib/`)
- [x] `lib/db.ts` — MongoDB singleton connect (from `server/config/db.js`)
- [x] `lib/auth.ts` — JWT sign/verify helpers + request auth middleware (from `server/middleware/auth.js`)
- [x] `lib/socket.ts` — Socket.IO server singleton + `setupMouseHandler` (from `server/socket/mouseHandler.js`)

### 1.3 Mongoose Models (`web/models/`)
- [x] `models/User.ts` — add `IUser` interface
- [x] `models/Gesture.ts` — add `IGesture` interface
- [x] `models/GestureLog.ts` — add `IGestureLog` interface
- [x] `models/Sample.ts` — add `ISample` interface

### 1.4 Custom Server (`web/server.ts`)
- [x] Create `server.ts` — Next.js programmatic server + Socket.IO attach
- [x] Add `ts-node` to `devDependencies`
- [x] Create `tsconfig.server.json` (CommonJS target for `server.ts`)
- [x] Update `package.json` scripts:
  - `"dev": "ts-node --project tsconfig.server.json server.ts"`
  - `"build": "next build"`
  - `"start": "NODE_ENV=production ts-node --project tsconfig.server.json server.ts"`

### 1.5 ML Trainer (`web/ml/`)
- [x] `ml/trainer.ts` — TF.js model training logic (from `server/ml/trainer.js`)
- [x] Move trained model output to `web/public/ml/model/` (served as static assets)

### 1.6 API Routes (`web/app/api/`)
- [x] `app/api/auth/register/route.ts` — POST register (from `server/routes/auth.js`)
- [x] `app/api/auth/login/route.ts` — POST login
- [x] `app/api/logs/route.ts` — GET + POST logs (from `server/routes/logs.js`)
- [x] `app/api/ml/status/route.ts` — GET status
- [x] `app/api/ml/gestures/route.ts` — GET all gestures, POST create gesture
- [x] `app/api/ml/gestures/batch/route.ts` — POST batch create gestures
- [x] `app/api/ml/collect/route.ts` — POST save samples
- [x] `app/api/ml/train/route.ts` — POST trigger training
- [x] `app/api/ml/import/route.ts` — POST import dataset

### 1.7 Context & Hooks (`web/context/`, `web/hooks/`)
- [x] `context/AuthContext.tsx` — convert from `AuthContext.jsx`, add types
- [x] `context/GestureContext.tsx` — convert from `GestureContext.jsx`, update API base URL to `/api` (relative, not `http://localhost:8000`)
- [x] `hooks/useMediaPipe.ts` — convert from `.js`, preserve singleton pattern exactly
- [x] `hooks/useGestureModel.ts` — convert from `.js`, type TF.js model
- [x] `hooks/useMouseControl.ts` — convert from `.js`
- [x] `hooks/useSocket.ts` — convert from `.js`, type socket events

### 1.8 Components (`web/components/`)
- [x] `components/Navbar.tsx`
- [x] `components/ProtectedRoute.tsx` — use Next.js `redirect()` pattern
- [x] `components/WebcamView.tsx`
- [x] `components/ConfidenceBar.tsx`
- [x] `components/GestureDisplay.tsx`
- [x] `components/ModeToggle.tsx`

### 1.9 Pages (`web/app/`)
- [x] `app/layout.tsx` — root layout with `AuthProvider`, `GestureProvider`, `Navbar`
- [x] `app/page.tsx` — Landing page (SSR, no `"use client"`)
- [x] `app/(auth)/login/page.tsx` — Login page
- [x] `app/(auth)/register/page.tsx` — Register page
- [x] `app/recognition/page.tsx` — `"use client"` (webcam + real-time recognition)
- [x] `app/history/page.tsx` — `"use client"`
- [x] `app/ml/collect/page.tsx` — `"use client"` (data collector)
- [x] `app/ml/import/page.tsx` — `"use client"`

### 1.10 Styling
- [x] Migrate `client/src/index.css` → `web/app/globals.css`
- [x] Migrate `client/src/App.css` → split into per-component CSS or keep global

---

## Phase 2 — Electron Desktop App (`desktop/`)

- [x] Add `typescript` and `ts-node` to `devDependencies`
- [x] Create `desktop/tsconfig.json` (`"module": "commonjs"`, `"outDir": "dist"`, `"strict": true`)
- [x] Create `desktop/src/main.ts` from `desktop/main.js`:
  - Change `loadURL` from `http://localhost:5173` → `http://localhost:3000`
  - Add TypeScript types for all IPC handlers
  - Add `WEB_URL` env var support for production
- [x] Create `desktop/src/preload.ts` from `desktop/preload.js` with typed `contextBridge`
- [x] Update `desktop/package.json`:
  - `"main": "dist/main.js"`
  - `"dev": "wait-on http://localhost:3000 && electron dist/main.js"`
  - `"build:ts": "tsc"`
  - `"build": "npm run build:ts && electron-builder"`
- [x] Add `electron-rebuild` to scripts and run after install (migrated to modern `@electron/rebuild`)
- [x] Verify `robotjs` IPC handlers work: `mouse:move`, `mouse:click`, `mouse:scroll`, `screen:size`

---

## Phase 3 — Integration & Verification

- [x] **TypeScript**: `tsc --noEmit` passes with zero errors in both `web/` and `desktop/`
- [x] **Web dev server**: `npm run dev` in `web/` starts Next.js + Socket.IO on `:3000`
- [x] **All pages load**: `/`, `/login`, `/register`, `/recognition`, `/history`, `/ml/collect`, `/ml/import`
- [x] **Auth flow**: Register → Login → JWT stored → `/history` accessible → Logout redirects
- [x] **Gesture list**: `GET /api/ml/gestures` returns seeded default gestures
- [x] **Sample collection**: `/ml/collect` saves samples via `POST /api/ml/collect`
- [x] **Model training**: `POST /api/ml/train` trains and saves model to `public/ml/model/`
- [x] **Recognition**: `/recognition` connects Socket.IO, landmarks sent, mouse moves on screen
- [x] **Electron**: `npm run dev` in `desktop/` opens Electron window loading `http://localhost:3000`
- [x] **IPC mouse control**: Mouse move, click, scroll, screen size all work via Electron IPC

---

## Phase 4 — Cleanup

- [x] Delete `client/` directory
- [x] Delete `server/` directory
- [x] Delete `desktop/main.js` (old CJS file, replaced by `desktop/src/main.ts`)
- [x] Delete `desktop/preload.js` (replaced by `desktop/src/preload.ts`)
- [x] Update root `package.json` to remove any references to old `client/` or `server/`
- [x] Update `AGENTS.md` if any architecture details changed during migration

---

## Notes & Blockers

> Use this section to log any decisions made or blockers hit during migration.

- API base URL in `GestureContext` was `http://localhost:8000` (hardcoded) — must be changed to relative `/api` in Next.js
- MediaPipe is loaded from CDN (`window.Hands`) — preserve the singleton and retry logic in `useMediaPipe.ts` exactly
- `@tensorflow/tfjs-node` can only be imported in `server.ts` scope — never in Next.js Route Handlers (they run in Edge runtime by default; must opt into Node.js runtime with `export const runtime = 'nodejs'`)
- The old client used `axios` — must convert all API calls to native `fetch` with manual auth headers
- The old `client/src/ml/collector.jsx` will become `app/ml/collect/page.tsx`
- No `import/route.ts` existed in server — the import page used client-side parsing + existing `/api/ml/collect` and `/api/ml/gestures/batch` endpoints
- **TFJS-Node Bundler Fix**: Added `serverExternalPackages: ['@tensorflow/tfjs-node']` to `next.config.ts` to allow compilation without Next.js attempting to bundle native binaries and mapbox pre-gyp modules.
