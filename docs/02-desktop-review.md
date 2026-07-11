# Desktop App Review

This review covers `desktop/`, including Electron main process setup, preload bridge, IPC handlers, packaging surface, and integration with the web app.

## P0: Renderer Origin Has OS-Control Privileges

`desktop/src/main.ts` loads `process.env.WEB_URL` with a fallback to `http://localhost:3000`. The preload bridge exposes mouse movement, click, scroll, screen size, and compact-window controls to whatever page is loaded.

Risk:

If `WEB_URL` is changed, intercepted, or pointed at untrusted content, that page receives an OS-control bridge. The current IPC handlers also trust payload shapes.

Suggested fix:

- Restrict `WEB_URL` to an allowlist, ideally local development URLs and a known production origin.
- Block navigation away from the allowed origin.
- Deny unexpected `window.open` targets.
- Use Electron permission handlers so camera access is only allowed for the expected origin.
- Validate every IPC payload in the main process before calling `robotjs`.
- Clamp mouse coordinates to the current display bounds.

## P0: IPC Surface Is Missing Some Controls The Web App Expects

The web app has gesture paths for drag and zoom, but the preload bridge only exposes:

- `mouseMove`
- `mouseClick`
- `mouseScroll`
- `getScreenSize`
- `setCompactMode`

Risk:

Drag uses `mouse:button` over Socket.IO. Zoom uses `zoom` over Socket.IO. In the normal setup, `web/` does not install `robotjs`, so these paths do not reach the OS.

Suggested fix:

- Add a typed `mouseButton(button, action)` IPC method.
- Add a typed `zoom(direction)` IPC method or a generic, validated `modifiedScroll`.
- Update `useTwoHandControl` and `useTwoHandZoom` to use Electron IPC when running in Electron.
- Keep Socket.IO out of local OS control unless `web/` intentionally owns native control.

## P0: IPC Payloads Need Runtime Guards

TypeScript types on IPC handlers do not protect runtime input. Renderer payloads can be malformed, missing, too large, or intentionally hostile.

Suggested fix:

Use small local type guards rather than adding a heavy dependency:

- `isFiniteNumber(x)`
- `isMouseButton(value)`
- `isMouseAction(value)`
- `isScrollDirection(value)`
- `isCompactPayload(value)`

Then reject invalid payloads before calling `robotjs`.

## P1: `robotjs` Is A Startup Failure Point

`desktop/src/main.ts` requires `robotjs` at module load. If the native binding is not rebuilt for the active Electron version, the app can crash before showing a useful error.

Suggested fix:

- Lazy-load `robotjs` inside a small native-control service.
- Cache either a loaded module or an unavailable state.
- Show a clear UI or main-process log when native control is unavailable.
- Keep `npm run rebuild` and Electron version notes in the desktop README.

## P1: BrowserWindow Security Should Be Tightened

The app already sets `nodeIntegration: false` and `contextIsolation: true`, which is good. It should go further because it exposes native input controls.

Suggested fix:

- Set `sandbox: true` if compatible with the preload bridge.
- Keep `webSecurity` enabled.
- Add navigation and new-window guards.
- Consider disabling DevTools in packaged builds only, while still allowing them in development.
- Consider a visible trust indicator if `WEB_URL` is not localhost.

## P1: Packaging Configuration Is Missing

`desktop/package.json` runs `electron-builder`, but the repository does not contain an `electron-builder.yml` or equivalent build config. `desktop/dist/` is present in the working tree.

Risk:

Packaging behavior is implicit. Native modules, preload files, app metadata, icons, and generated output can drift.

Suggested fix:

- Add `desktop/electron-builder.yml`.
- Set `appId`, product name, output directory, file includes, native module handling, and platform targets.
- Add a desktop `.gitignore` or root `.gitignore` for `dist/`, release output, and native rebuild artifacts.
- Decide whether compiled `desktop/dist/` should be committed. Usually it should not be.

## P1: Production Desktop Story Is Incomplete

The desktop app is a shell that loads `http://localhost:3000` unless `WEB_URL` is set. In production, that means the app either needs an already-running web server or a packaged web runtime.

Suggested fix:

Document one production mode:

- Local companion mode: user starts the web app separately, desktop connects to it.
- Managed mode: desktop starts the custom web server as a child process.
- Hosted mode: desktop loads a trusted hosted URL.

Each mode has different security and update implications. The code should make the chosen mode explicit.

## P2: Compact Window Needs Display-Aware Behavior

Compact mode always uses the primary display width and a fixed `y = 40`.

Suggested fix:

- Position relative to the current window display, not always the primary display.
- Clamp compact bounds to the work area.
- Restore the previous bounds reliably after display changes.
- Add keyboard or menu fallback to leave compact mode if gesture control fails.

## P2: Desktop Documentation Should Be Added

Suggested fix:

- Add a `desktop/README.md`.
- Include setup, `npx electron-rebuild`, development run order, native module troubleshooting, and packaging notes.
- Document macOS accessibility permissions needed for `robotjs` mouse control.

