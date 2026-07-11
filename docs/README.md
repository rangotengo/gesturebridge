# GestureBridge Review Notes

This folder is the working backlog from the June 28, 2026 codebase review. It covers the active projects only:

- `web/`: Next.js app, custom server, Socket.IO, MediaPipe, TF.js, MongoDB routes.
- `desktop/`: Electron shell and OS mouse-control bridge.

Legacy `client/` and `server/` were intentionally not reviewed or modified.

## How to Use These Docs

Start with the remediation backlog, then open the project-specific notes when you need context.

1. `04-remediation-backlog.md`: ordered checklist with acceptance criteria.
2. `01-web-review.md`: web app findings and suggested fixes.
3. `02-desktop-review.md`: Electron findings and suggested fixes.
4. `03-tooling-and-verification.md`: commands run and what passed or failed.

## Priority Guide

| Priority | Meaning |
| --- | --- |
| P0 | Security, data integrity, or core gesture-control behavior can break or be abused. |
| P1 | Important maintainability, reliability, or developer-experience issue. |
| P2 | Cleanup, consistency, or polish that should follow the main repairs. |

## Review Snapshot

The repository type-checks and the web production build succeeds. The main concerns are not syntax-level problems. They are architecture and product-readiness issues:

- Auth is documented as complete but is not implemented in the current source.
- ML mutation routes are open and can poison training data or trigger expensive work.
- Desktop OS-control permissions are too broad for a renderer loaded from `WEB_URL`.
- Drag and zoom controls are split across Electron IPC and Socket.IO in a way that leaves some controls ineffective when `robotjs` is not installed in `web/`.
- Server state is managed manually instead of through TanStack Query.
- Styling conventions are inconsistent with the project guardrails.
- Linting is currently not runnable with the installed Next.js version.

