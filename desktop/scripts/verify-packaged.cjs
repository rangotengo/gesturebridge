const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const executable = path.resolve(process.argv[2]);
assert.ok(fs.existsSync(executable), `Packaged executable not found: ${executable}`);
const resources = process.platform === 'darwin'
  ? path.resolve(path.dirname(executable), '../Resources')
  : path.join(path.dirname(executable), 'resources');
const robot = path.join(resources, 'app.asar.unpacked/node_modules/robotjs');
const marker = 'PACKAGED_LAUNCH_OK';
const code = `require(${JSON.stringify(robot)}); console.log(${JSON.stringify(marker)});`;

// Run the shipped executable, rather than node_modules/electron. This exercises
// macOS's dynamic loader and the packaged native module without camera prompts.
const result = spawnSync(executable, ['-e', code], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 30_000,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
assert.equal(result.signal, null, `Packaged app terminated with ${result.signal}`);
assert.equal(result.status, 0, `Packaged app exited with ${result.status}`);
assert.ok(result.stdout.includes(marker), 'Packaged app did not finish the launch check');
