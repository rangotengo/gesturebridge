const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IpcRateLimiter,
  MAX_ABSOLUTE_COORDINATE,
  isAllowedLocalUrl,
  isAllowedNavigation,
  isTrustedSenderUrl,
  parsePointPayload,
} = require('../dist/security.js');

test('only credential-free loopback web URLs are allowed', () => {
  assert.equal(isAllowedLocalUrl('http://localhost:3000'), true);
  assert.equal(isAllowedLocalUrl('https://127.0.0.1:3000/path'), true);
  assert.equal(isAllowedLocalUrl('http://[::1]:3000'), true);
  assert.equal(isAllowedLocalUrl('https://example.com'), false);
  assert.equal(isAllowedLocalUrl('file:///tmp/index.html'), false);
  assert.equal(isAllowedLocalUrl('http://localhost:3000@evil.example'), false);
  assert.equal(isAllowedLocalUrl('http://user:password@localhost:3000'), false);
});

test('navigation and IPC sender URLs must stay on the configured app origin', () => {
  const origin = 'http://localhost:3000';
  assert.equal(isAllowedNavigation('http://localhost:3000/history', origin), true);
  assert.equal(isAllowedNavigation('http://localhost:3001/', origin), false);
  assert.equal(isAllowedNavigation('https://localhost:3000/', origin), false);

  assert.equal(isTrustedSenderUrl('http://localhost:3000/', origin), true);
  assert.equal(isTrustedSenderUrl('http://localhost:3000/?mode=mouse', origin), true);
  assert.equal(isTrustedSenderUrl('http://localhost:3000/history', origin), false);
  assert.equal(isTrustedSenderUrl('http://localhost:3000@evil.example/', origin), false);
});

test('mouse coordinates reject malformed, non-finite, and unreasonable values', () => {
  assert.deepEqual(parsePointPayload({ x: 100.25, y: -50 }), { x: 100.25, y: -50 });
  assert.equal(parsePointPayload(null), null);
  assert.equal(parsePointPayload({ x: Number.NaN, y: 1 }), null);
  assert.equal(parsePointPayload({ x: Infinity, y: 1 }), null);
  assert.equal(parsePointPayload({ x: MAX_ABSOLUTE_COORDINATE + 1, y: 0 }), null);
  assert.equal(parsePointPayload({ x: '1', y: 0 }), null);
});

test('rate limiter enforces a per-renderer/channel window and resets deterministically', () => {
  const limiter = new IpcRateLimiter(1_000, 4);
  assert.equal(limiter.consume(1, 'mouse:move', 2, 100), true);
  assert.equal(limiter.consume(1, 'mouse:move', 2, 200), true);
  assert.equal(limiter.consume(1, 'mouse:move', 2, 300), false);
  assert.equal(limiter.consume(1, 'mouse:scroll', 2, 300), true);
  assert.equal(limiter.consume(2, 'mouse:move', 2, 300), true);
  assert.equal(limiter.consume(1, 'mouse:move', 2, 1_100), true);
});

test('rate limiter clears expired entries before accepting a new renderer channel', () => {
  const limiter = new IpcRateLimiter(1_000, 2);
  assert.equal(limiter.consume(1, 'first', 1, 0), true);
  assert.equal(limiter.consume(2, 'second', 1, 0), true);
  assert.equal(limiter.consume(3, 'third', 1, 1_001), true);
  assert.equal(limiter.consume(3, 'third', 1, 1_002), false);
});
