# Remediation Backlog

Use this as the one-by-one repair checklist. Keep entries small enough to become individual commits or pull requests.

## P0: Fix Security And Core Control Behavior

### 1. Decide The Auth Boundary

Files:

- `web/components/ProtectedRoute.tsx`
- `web/app/api/**`
- `TASK.md`
- `web/package.json`

Work:

- Decide whether this app is local-only or authenticated.
- If authenticated, implement auth before more feature work.
- If local-only, remove stale auth claims and unused auth dependencies.

Acceptance criteria:

- Docs and source agree.
- Protected routes are either truly protected or explicitly documented as local-only.
- ML mutation routes are not accidentally public in any production mode.

### 2. Protect ML Mutation Routes

Files:

- `web/app/api/ml/collect/route.ts`
- `web/app/api/ml/import/route.ts`
- `web/app/api/ml/train/route.ts`
- `web/app/api/ml/seed/route.ts`
- `web/app/api/ml/gestures/route.ts`
- `web/app/api/ml/gestures/batch/route.ts`

Work:

- Add auth or local admin guard.
- Add batch-size limits.
- Add rate limits for training and seeding.
- Disable or guard seed outside development.

Acceptance criteria:

- Anonymous clients cannot mutate training data in production mode.
- Repeated train/seed calls are blocked or queued.
- Route errors return clear JSON with appropriate status codes.

### 3. Centralize Sample Validation

Files:

- `web/app/api/ml/collect/route.ts`
- `web/app/api/ml/import/route.ts`
- `web/app/api/ml/seed/route.ts`
- `web/models/Sample.ts`

Work:

- Create a shared validation utility for training samples.
- Require 63 finite numeric feature values.
- Require integer labels.
- Reject unknown labels unless a route explicitly creates them first.
- Add tests for valid, invalid, oversized, and mixed batches.

Acceptance criteria:

- Collect and import apply identical validation.
- Invalid samples are never inserted.
- Error responses include rejected counts or reasons.

### 4. Fix Hand Role Mirroring

Files:

- `web/hooks/useMediaPipe.ts`
- `web/hooks/useHandRoles.ts`
- `web/app/page.tsx`
- `web/ml/gestureUtils.ts`

Work:

- Decide whether `HandData.handedness` is raw MediaPipe or user-perspective.
- Remove the second mirror transform if the data is already user-perspective.
- Add tests for dominant and modifier assignment.

Acceptance criteria:

- Right hand controls mouse in mirrored webcam view.
- Left hand acts as modifier in two-hand mode.
- Tests cover one-hand, two-hand, mirrored, and non-mirrored cases.

### 5. Move All OS Control To Desktop IPC

Files:

- `desktop/src/preload.ts`
- `desktop/src/main.ts`
- `web/hooks/useMouseControl.ts`
- `web/hooks/useTwoHandControl.ts`
- `web/hooks/useTwoHandZoom.ts`
- `web/lib/socket.ts`

Work:

- Add IPC for mouse button down/up.
- Add IPC for zoom or modified scroll.
- Update web hooks to use Electron IPC for all OS actions when available.
- Remove duplicate Socket.IO OS-control emits from Electron mode.
- Decide whether server-side `robotjs` should remain at all.

Acceptance criteria:

- Move, left click, right click, middle click, scroll, drag, freeze, and zoom all work in Electron without `robotjs` installed in `web/`.
- Socket.IO is no longer required for local desktop OS control.
- No gesture triggers duplicate native actions.

### 6. Lock Down Electron IPC And Navigation

Files:

- `desktop/src/main.ts`
- `desktop/src/preload.ts`

Work:

- Add runtime payload guards for all IPC handlers.
- Clamp mouse coordinates to screen bounds.
- Restrict navigation to allowed origins.
- Block unexpected new windows.
- Add permission handling for camera access.

Acceptance criteria:

- Malformed IPC payloads are rejected safely.
- Untrusted URLs cannot receive the OS-control bridge.
- Camera permission is granted only to the expected web origin.

## P1: Improve Reliability And Maintainability

### 7. Add TanStack Query

Files:

- `web/app/layout.tsx`
- `web/context/GestureContext.tsx`
- `web/app/history/page.tsx`
- `web/app/ml/collect/page.tsx`
- `web/app/ml/import/page.tsx`
- `web/app/page.tsx`

Work:

- Add `@tanstack/react-query@latest`.
- Add QueryClient provider.
- Create feature-level `queries.ts` files.
- Convert server-state reads and mutations.

Acceptance criteria:

- Async server state uses query keys.
- Loading, error, refetch, mutation, and invalidation behavior is centralized.
- Pages no longer hand-roll fetch lifecycle state.

### 8. Fix Linting And Add Tests

Files:

- `web/package.json`
- `desktop/package.json`
- new ESLint/test config files as needed

Work:

- Replace broken `next lint` script.
- Add lint scripts for web and desktop.
- Add unit tests for validation, gesture utilities, and hand roles.
- Add route-handler tests for ML input validation.

Acceptance criteria:

- `npm run lint` works in `web/`.
- Desktop has an equivalent lint command.
- A root verification command can run type-checks, lint, tests, and web build.

### 9. Make Training A Managed Job

Files:

- `web/ml/trainer.ts`
- `web/app/api/ml/train/route.ts`
- `web/app/api/ml/status/route.ts`
- model metadata files or MongoDB model job collection

Work:

- Add training lock or queue.
- Add model version metadata.
- Save to versioned directories.
- Track metrics and errors.
- Update status route and UI.

Acceptance criteria:

- Concurrent training requests cannot corrupt the active model.
- UI can show queued, running, failed, and completed states.
- Active model can be identified by version.

### 10. Normalize Gesture Registration

Files:

- `web/models/Gesture.ts`
- `web/app/api/ml/gestures/route.ts`
- `web/app/api/ml/gestures/batch/route.ts`

Work:

- Add normalized-name storage.
- Escape or remove regex matching.
- Make label-index allocation atomic.
- Share default seeding code.

Acceptance criteria:

- Special characters in gesture names do not throw.
- Concurrent creates do not create duplicate label indexes.
- Default gestures are seeded from one utility.

## P2: Clean Up Product And Documentation

### 11. Align Styling With The Project Standard

Files:

- `web/app/globals.css`
- `web/app/ml/collect/page.tsx`
- `web/app/ml/import/page.tsx`
- `web/app/history/page.tsx`
- shared components

Work:

- Resolve the Tailwind versus vanilla CSS contradiction in `AGENTS.md`.
- Migrate embedded and inline styles to Tailwind utilities.
- Keep only base styles and approved utilities in `globals.css`.

Acceptance criteria:

- No large embedded `<style>` blocks remain.
- Inline styles are limited to truly dynamic values.
- Pages follow one visual system.

### 12. Update Project Docs

Files:

- `TASK.md`
- `web/README.md`
- new `desktop/README.md`
- root `README.md` if desired

Work:

- Replace create-next-app README content.
- Correct completed task checkboxes.
- Document local setup, MongoDB, MediaPipe CDN, TF.js model files, Electron rebuild, and run order.

Acceptance criteria:

- A new contributor can run web and desktop from docs alone.
- Docs do not mention missing auth pages as complete.
- Commands use `npm` and `npx` only.

### 13. Add Packaging And Ignore Rules

Files:

- `desktop/electron-builder.yml`
- root `.gitignore` or `desktop/.gitignore`
- `desktop/package.json`

Work:

- Add explicit Electron Builder config.
- Ignore generated desktop output.
- Decide whether `desktop/dist/` belongs in source control.

Acceptance criteria:

- Desktop packaging inputs are explicit.
- Generated artifacts are not mixed with source unless intentionally committed.

