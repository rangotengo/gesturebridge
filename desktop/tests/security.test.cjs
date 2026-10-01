const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IpcRateLimiter,
  MAX_ABSOLUTE_COORDINATE,
  isAllowedLocalUrl,
  isAllowedMediaPermission,
  isAllowedNavigation,
  isTrustedOriginUrl,
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

  assert.equal(isTrustedOriginUrl('http://localhost:3000/', origin), true);
  assert.equal(isTrustedOriginUrl('http://localhost:3000/history', origin), true);
  assert.equal(isTrustedOriginUrl('http://localhost:3001/history', origin), false);
});

test('media permissions allow camera and microphone access', () => {
  assert.equal(isAllowedMediaPermission('media'), true);
  assert.equal(isAllowedMediaPermission('camera'), true);
  assert.equal(isAllowedMediaPermission('microphone'), true);
  assert.equal(isAllowedMediaPermission('video-capture'), true);
  assert.equal(isAllowedMediaPermission('audio-capture'), true);
  assert.equal(isAllowedMediaPermission('geolocation'), false);
  assert.equal(isAllowedMediaPermission('notifications'), false);
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

test('isValidAuthToken requires valid token and matches expected token', () => {
  const { isValidAuthToken } = require('../dist/security.js');
  const validSecret = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
  assert.equal(isValidAuthToken({ token: validSecret }, validSecret), true);
  assert.equal(isValidAuthToken({ token: 'wrong-secret' }, validSecret), false);
  assert.equal(isValidAuthToken(null, validSecret), false);
  assert.equal(isValidAuthToken({}, validSecret), false);
  assert.equal(isValidAuthToken({ token: 12345 }, validSecret), false);
  assert.equal(isValidAuthToken({ token: validSecret }, ''), false);
});

test('DeadmanTimer invokes callback on timeout and cancels cleanly', (t, done) => {
  const { DeadmanTimer } = require('../dist/security.js');
  let fired = false;
  const timer = new DeadmanTimer(50, () => {
    fired = true;
    assert.equal(fired, true);
    done();
  });

  assert.equal(timer.isActive(), false);
  timer.heartbeat();
  assert.equal(timer.isActive(), true);
});

test('DeadmanTimer cancel prevents timeout invocation', (t, done) => {
  const { DeadmanTimer } = require('../dist/security.js');
  let fired = false;
  const timer = new DeadmanTimer(40, () => {
    fired = true;
  });

  timer.heartbeat();
  timer.cancel();
  assert.equal(timer.isActive(), false);

  setTimeout(() => {
    assert.equal(fired, false);
    done();
  }, 70);
});
