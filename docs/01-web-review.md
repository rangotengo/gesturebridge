# Web App Review

This review covers `web/`, including the custom Next.js server, API routes, models, hooks, components, and pages.

## P0: Auth Is Documented But Not Implemented

`TASK.md` says auth routes, user model, auth context, login/register pages, and protected flows are complete. The source does not match that state.

Evidence:

- No `web/models/User.ts`.
- No `web/lib/auth.ts`.
- No `web/app/api/auth/*` routes.
- No login/register pages under `web/app`.
- `web/components/ProtectedRoute.tsx` directly renders children with no checks.
- `web/package.json` still includes `bcrypt` and `jsonwebtoken`, but no active source uses them.

Risk:

All app pages and API routes are effectively public. Anyone who can reach the web server can read logs, create gestures, insert samples, seed synthetic data, and trigger training.

Suggested fix:

Decide whether GestureBridge is meant to be a single-user local tool or a multi-user app. If it is multi-user, implement auth end to end before adding more feature work:

- Add `User` model and auth helpers.
- Add login/register routes or server actions.
- Store auth in secure HTTP-only cookies.
- Add request auth helpers for route handlers.
- Restore a real `ProtectedRoute` or server-side redirects.
- Scope `GestureLog`, `Gesture`, and `Sample` data by user where appropriate.

If it is intentionally local-only, remove the stale auth claims from `TASK.md`, remove unused auth dependencies, and clearly document the trust boundary.

## P0: ML Mutation Routes Are Open

The following routes mutate persistent data or trigger heavy work without auth, ownership checks, CSRF protection, rate limits, or body-size limits:

- `POST /api/ml/collect`
- `POST /api/ml/import`
- `POST /api/ml/train`
- `POST /api/ml/seed`
- `POST /api/ml/gestures`
- `POST /api/ml/gestures/batch`
- `POST /api/logs`

Risk:

An unauthenticated client can poison the training corpus, create unbounded gesture labels, fill MongoDB, repeatedly start training, and pollute gesture history.

Suggested fix:

- Require auth or an explicit local-only admin token for ML mutation routes.
- Add per-route payload size limits and maximum batch counts.
- Add rate limits around training, seed, import, and collect.
- Add a training lock so only one training job runs at a time.
- Make seed idempotent or restrict it to development.

## P0: Sample Validation Is Incomplete

`web/app/api/ml/collect/route.ts` inserts `samples` directly after only checking that it is a non-empty array.

`web/app/api/ml/import/route.ts` validates feature length and label type, but it does not verify that all 63 feature values are finite numbers, that labels are integers, or that labels correspond to registered gestures.

Risk:

Bad payloads can be stored and later loaded into TensorFlow training. This can cause training failures, bad models, or database bloat.

Suggested fix:

- Share a server-side validation function for `{ features, label }`.
- Require exactly 63 finite numbers.
- Require integer labels that map to known gestures.
- Cap request batch size.
- Return a count of accepted and rejected samples.
- Apply the same validation to collect, import, and seed.

## P0: Hand Role Assignment May Be Double-Mirrored

`useMediaPipe` mirror-corrects handedness before putting it into `HandData`. `app/page.tsx` then passes that already-corrected handedness to `assignHandRoles(..., MIRRORED_FEED)`, whose logic applies mirror semantics again.

Evidence:

- `web/hooks/useMediaPipe.ts` converts MediaPipe `Left` to user `Right`.
- `web/app/page.tsx` passes `hands.map((h) => h.handedness)` into `assignHandRoles`.
- `web/hooks/useHandRoles.ts` treats `mirroredFeed=true` as a signal to flip camera labels.

Risk:

With two hands visible, dominant and modifier roles can be reversed. That affects cursor movement, freeze, drag, middle click, and zoom gestures.

Suggested fix:

- Make `HandData.handedness` mean one thing: either raw MediaPipe handedness or user-perspective handedness.
- Rename types if needed, for example `RawHandedness` and `UserHandedness`.
- Update `assignHandRoles` to accept the chosen representation.
- Add small unit tests for one-hand and two-hand role assignment with mirrored and non-mirrored inputs.

## P0: Native Control Path Is Split Between IPC And Socket.IO

The current control path mixes Electron IPC and Socket.IO.

Evidence:

- `useMouseControl` sends move, click, and scroll through `window.electronAPI` and also emits Socket.IO events.
- `useTwoHandControl` uses Socket.IO for drag down/up, but Electron preload does not expose `mouseToggle`.
- `useTwoHandZoom` emits a Socket.IO `zoom` event, but Electron preload does not expose zoom or keyboard-modified scroll.
- `web/lib/socket.ts` tries to require `robotjs`, but `web/package.json` does not install `robotjs` by design.

Risk:

Basic move/click/scroll can work through Electron IPC. Drag and zoom are likely no-ops in the normal desktop setup because their only native path depends on `robotjs` inside `web/`.

Suggested fix:

Pick one native-control boundary:

- Preferred: keep OS control inside `desktop/` only.
- Add typed IPC methods for `mouseButton`, `zoom`, and any future window actions.
- Remove or demote server-side `robotjs` from `web/lib/socket.ts`.
- Keep Socket.IO for browser-to-server telemetry or collaboration only, not local OS control.
- Add a small desktop integration test or manual checklist for move, click, scroll, drag, freeze, and zoom.

## P1: Server State Should Move To TanStack Query

The project guardrails call for TanStack Query v5 for async server state. The current app uses manual `fetch`, `useState`, and `useEffect` in several places:

- `GestureContext`
- `history/page.tsx`
- `ml/collect/page.tsx`
- `ml/import/page.tsx`
- Inline training and logging calls in `app/page.tsx`

Suggested fix:

- Install `@tanstack/react-query@latest`.
- Add a `QueryClientProvider` in `app/layout.tsx` through a small client provider.
- Create per-feature `queries.ts` files with stable query keys.
- Convert gesture list, history logs, ML status, import, collect, train, seed, and gesture mutations to `useQuery` or `useMutation`.
- Use mutation invalidation for gesture labels and history.

## P1: Training Needs A Safer Lifecycle

`trainModel()` loads all samples, trains in the route request, and writes directly into `public/ml/model`.

Risk:

Large datasets can exhaust memory. Concurrent training requests can race on model output files. There is no model version metadata, no evaluation record, and no rollback path.

Suggested fix:

- Add a training status collection or singleton job record.
- Reject or queue concurrent training.
- Save each model under a versioned directory, then atomically update the active model pointer.
- Store sample count, class count, accuracy, validation accuracy, started/finished timestamps, and error state.
- Add a status endpoint that the UI can poll with TanStack Query.

## P1: Gesture Registration Has Race And Regex Issues

`POST /api/ml/gestures` builds a `RegExp` from user input and calculates the next `labelIndex` from the current max.

Risk:

Special regex characters can throw or match unintended names. Concurrent requests can compute the same next index and fail with unique index errors.

Suggested fix:

- Escape regex input or use normalized-name fields for exact lookup.
- Add a `normalizedName` field with a unique index.
- Use a transaction or atomic counter for `labelIndex`.
- Move default gesture seeding into one shared server utility instead of duplicating it across routes.

## P1: Lint And Test Coverage Are Missing

TypeScript passes, but `npm run lint` fails before linting with:

```text
Invalid project directory provided, no such directory: /Users/arunshrestha/Development/gestureBridge/web/lint
```

Suggested fix:

- Replace `next lint` with an ESLint CLI setup that matches Next 16.
- Add scripts for `lint`, `type-check`, and `test`.
- Add focused tests for validation, gesture utilities, hand-role assignment, model label mapping, and route handlers.

## P1: Styling Conventions Are Mixed

The active code uses Tailwind utilities, `globals.css` component classes, embedded `<style>` blocks, and inline styles. This conflicts with the guardrail that says to use Tailwind utility classes and theme extension rather than vanilla CSS files, CSS modules, or inline style objects.

Examples:

- `web/app/globals.css` defines many component classes.
- `web/app/ml/collect/page.tsx` embeds a large `<style>` block.
- `web/app/ml/import/page.tsx` relies heavily on inline styles.
- Several components use inline `style={{ ... }}` for colors and layout.

Suggested fix:

- First resolve the contradictory project note that also mentions vanilla CSS in a later table.
- Choose Tailwind as the standard, since the guardrails put that first.
- Add or document Tailwind v4 theme configuration.
- Migrate one page at a time from inline and embedded CSS to utility classes.
- Keep only true global base styles and Tailwind layers in `globals.css`.

## P2: Documentation Drift Should Be Cleaned Up

`TASK.md` and `web/README.md` do not describe the current app accurately.

Suggested fix:

- Rewrite `web/README.md` for this project, removing create-next-app defaults and yarn/pnpm/bun commands.
- Update `TASK.md` so completed boxes match actual files.
- Document the current local-only or auth-enabled decision.
- Document the required run command: `node server.ts` through `npm run dev`, not `next start`.

