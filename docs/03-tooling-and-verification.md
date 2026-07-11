# Tooling And Verification Notes

These checks were run during the review on June 28, 2026.

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `cd web && npm run type-check` | Pass | TypeScript completed with no errors. |
| `cd desktop && npx tsc --noEmit` | Pass | Desktop TypeScript completed with no errors. |
| `cd web && npm run lint` | Fail | `next lint` is not usable with the current setup. |
| `cd web && npm run build` | Pass | Production build completed with Next 16.2.6 and Turbopack. |

## Lint Failure

`npm run lint` fails with:

```text
Invalid project directory provided, no such directory: /Users/arunshrestha/Development/gestureBridge/web/lint
```

Likely cause:

The script still uses `next lint`, but the installed Next version no longer supports that flow in the expected way.

Recommended action:

- Add a normal ESLint setup and update the script to call `eslint`.
- Keep `npm run type-check` separate from lint.
- Add CI or a local `npm run verify` command once lint works.

## Build Notes

`npm run build` succeeds. During static page generation, TensorFlow logs many duplicate backend and kernel registration warnings, including repeated messages for CPU and WebGL kernels.

Recommended action:

- Investigate whether `@tensorflow/tfjs` and `@tensorflow/tfjs-node` are both initialized during page-data collection.
- Keep server-only TF.js imports isolated behind Node-only route handlers.
- Avoid importing server trainer code from files that can be evaluated during static generation.
- Consider suppressing only known noisy TF logs after the import boundary is proven correct.

## Checks Not Run

These were not run during this review:

- Live webcam recognition.
- Electron window launch.
- Real OS mouse movement, drag, zoom, or compact mode.
- MongoDB-backed route behavior.
- Desktop packaging with `electron-builder`.

Reason:

Those checks require interactive camera, OS accessibility permissions, a running MongoDB instance, or packaging side effects. They should be run as part of the P0 remediation verification checklist.

## Suggested Verify Script

Once lint and tests exist, add root scripts similar to:

```json
{
  "scripts": {
    "verify:web": "cd web && npm run lint && npm run type-check && npm run build",
    "verify:desktop": "cd desktop && npm run lint && npx tsc --noEmit",
    "verify": "npm run verify:web && npm run verify:desktop"
  }
}
```

Use `npm` and `npx` only.

