import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = path.join(root, 'public', 'vendor', 'mediapipe');
const handsSource = path.join(root, 'node_modules', '@mediapipe', 'hands');
const faceMeshSource = path.join(root, 'node_modules', '@mediapipe', 'face_mesh');
const drawingSource = path.join(root, 'node_modules', '@mediapipe', 'drawing_utils', 'drawing_utils.js');

await rm(vendorRoot, { recursive: true, force: true });
await mkdir(path.join(vendorRoot, 'hands'), { recursive: true });
await mkdir(path.join(vendorRoot, 'face_mesh'), { recursive: true });
await cp(handsSource, path.join(vendorRoot, 'hands'), {
  recursive: true,
  filter: (source) => !source.endsWith('README.md') && !source.endsWith('package.json') && !source.endsWith('index.d.ts'),
});
await cp(faceMeshSource, path.join(vendorRoot, 'face_mesh'), {
  recursive: true,
  filter: (source) => !source.endsWith('README.md') && !source.endsWith('package.json') && !source.endsWith('index.d.ts'),
});
await cp(drawingSource, path.join(vendorRoot, 'drawing_utils.js'));
