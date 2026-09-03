# GestureBridge Web

GestureBridge turns MediaPipe hand landmarks into gesture predictions. Browser mode shows recognition results; Electron mode can translate approved gestures into OS mouse actions through a restricted preload bridge.

This app uses a custom Node server because Socket.IO must share the same HTTP server as Next.js. Do not run `next start` directly.

## Requirements

- Current Node.js LTS
- MongoDB
- A working native build environment for `@tensorflow/tfjs-node`

Install dependencies:

```bash
npm install
```

Copy `.env.example` to `.env` and set `MONGODB_URI` plus a long random `JWT_SECRET`.

The first visit to Admin creates a bootstrap account at `/admin/signup` (stored in MongoDB). After that, use `/admin/login`.

## Development

```bash
npm run dev
```

The custom server starts Next.js and Socket.IO together. Default URL is `http://127.0.0.1:3000`.

Useful checks:

```bash
npm run type-check
npm run lint
npm test
npm run build
```

## Training lifecycle

Recognition uses a browser TF.js model from `public/ml/model`. Training uses `@tensorflow/tfjs-node` on the server and MongoDB samples. Model labels must stay aligned with gesture label indexes; model artifacts should include the generated manifest.

Runtime model generation needs a writable persistent filesystem. Serverless and multi-replica deployments require external artifact storage plus an active-model registry. A plain Vercel deployment does not provide the custom Socket.IO server or durable runtime model storage this app expects.

## Production

Build Next.js and the custom server, then start compiled JavaScript:

```bash
npm run build
npm start
```

Run behind TLS when exposed beyond localhost. Configure `HOST`, allowed origins, MongoDB authentication, process supervision, and persistent model storage. For Electron-only use, keep `HOST=127.0.0.1`.

## Desktop shell

The sibling `desktop` project loads this server and exposes narrow mouse-control IPC methods. Rebuild its native dependencies after install:

```bash
cd ../desktop
npm install
npm run rebuild
```

Camera and OS accessibility permissions remain platform-specific and need release-machine testing.
