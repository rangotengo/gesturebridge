const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEADMAN_TIMEOUT_MS,
  DeadmanTimer,
  HeldButtonTracker,
  IpcRateLimiter,
  MAX_ABSOLUTE_COORDINATE,
  isAllowedLocalUrl,
  isAllowedMediaPermission,
  isAllowedNavigation,
  isTrustedOriginUrl,
  isTrustedSenderUrl,
  parsePointPayload,
} = require('../dist/security.js');

test('local URL validation rejects external hosts and userinfo', () => {
  assert.equal(isAllowedLocalUrl('http://localhost:3000'), true);
  assert.equal(isAllowedLocalUrl('http://127.0.0.1:3000/path?query=1'), true);
  assert.equal(isAllowedLocalUrl('https://localhost:443'), true);
  assert.equal(isAllowedLocalUrl('http://attacker.com'), false);
  assert.equal(isAllowedLocalUrl('http://user:pass@localhost:3000'), false);
  assert.equal(isAllowedLocalUrl('javascript:alert(1)'), false);
});

test('navigation and IPC sender URLs must stay on the configured app origin', () => {
  const origin = 'http://localhost:3000';
  assert.equal(isAllowedNavigation('http://localhost:3000/settings', origin), true);
  assert.equal(isAllowedNavigation('http://localhost:3001/settings', origin), false);
  assert.equal(isAllowedNavigation('https://evil.com/settings', origin), false);

  assert.equal(isTrustedSenderUrl('http://localhost:3000/', origin), true);
  assert.equal(isTrustedSenderUrl('http://localhost:3000/?mode=mouse', origin), true);
  assert.equal(isTrustedSenderUrl('http://localhost:3000/history', origin), false);
  assert.equal(isTrustedSenderUrl('http://localhost:3000@evil.example/', origin), false);

  assert.equal(isTrustedOriginUrl('http://localhost:3000/', origin), true);
  assert.equal(isTrustedOriginUrl('http://localhost:3000/history', origin), true);
  assert.equal(isTrustedOriginUrl('http://localhost:3001/history', origin), false);
});

test('permissions allow media and clipboard access', () => {
  assert.equal(isAllowedMediaPermission('media'), true);
  assert.equal(isAllowedMediaPermission('camera'), true);
  assert.equal(isAllowedMediaPermission('microphone'), true);
  assert.equal(isAllowedMediaPermission('video-capture'), true);
  assert.equal(isAllowedMediaPermission('audio-capture'), true);
  assert.equal(isAllowedMediaPermission('clipboard-read'), true);
  assert.equal(isAllowedMediaPermission('clipboard-sanitized-write'), true);
  assert.equal(isAllowedMediaPermission('geolocation'), false);
  assert.equal(isAllowedMediaPermission('notifications'), false);
});

test('mouse coordinates reject malformed, non-finite, and unreasonable values', () => {
  assert.deepEqual(parsePointPayload({ x: 100.25, y: -50 }), { x: 100.25, y: -50 });
  assert.equal(parsePointPayload(null), null);
  assert.equal(parsePointPayload({ x: Number.NaN, y: 1 }), null);
  assert.equal(parsePointPayload({ x: Infinity, y: 1 }), null);
  assert.equal(parsePointPayload({ x: MAX_ABSOLUTE_COORDINATE + 1, y: 0 }), null);
  assert.equal(parsePointPayload({ x: 0, y: -(MAX_ABSOLUTE_COORDINATE + 1) }), null);
});

test('IPC rate limiter drops events exceeding frequency threshold and supports pruning', () => {
  const limiter = new IpcRateLimiter(1_000, 2);
  const senderId = 1;
  const channel = 'mouse:move';

  assert.equal(limiter.consume(senderId, channel, 2, 0), true);
  assert.equal(limiter.consume(senderId, channel, 2, 100), true);
  assert.equal(limiter.consume(senderId, channel, 2, 200), false);
  assert.equal(limiter.consume(senderId, channel, 2, 1_001), true);

  limiter.consume(2, 'channel:a', 5, 1_100);
  limiter.consume(3, 'channel:b', 5, 1_200);
  limiter.consume(4, 'channel:c', 5, 2_500);

  limiter.clear();
  assert.equal(limiter.consume(senderId, channel, 1, 3_000), true);
});

test('Deadman timer fires after inactivity timeout and supports cancellation', async () => {
  let timedOut = false;
  const timer = new DeadmanTimer(25, () => {
    timedOut = true;
  });

  timer.heartbeat();
  assert.equal(timer.isRunning(), true);

  await new Promise((resolve) => setTimeout(resolve, 10));
  timer.heartbeat();

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(timedOut, false);

  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(timedOut, true);
  assert.equal(timer.isRunning(), false);

  timedOut = false;
  timer.heartbeat();
  timer.cancel();
  assert.equal(timer.isRunning(), false);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(timedOut, false);
});

test('HeldButtonTracker records state transitions idempotently', () => {
  const tracker = new HeldButtonTracker();

  assert.equal(tracker.press('left'), true);
  assert.equal(tracker.press('left'), false);
  assert.equal(tracker.has('left'), true);
  assert.equal(tracker.size(), 1);

  assert.equal(tracker.release('right'), false);
  assert.equal(tracker.release('left'), true);
  assert.equal(tracker.size(), 0);

  tracker.press('left');
  tracker.press('right');
  const released = tracker.releaseAll('emergency-stop');
  assert.deepEqual(released?.buttons.sort(), ['left', 'right']);
  assert.equal(released?.reason, 'emergency-stop');
  assert.equal(tracker.size(), 0);
  assert.equal(tracker.releaseAll(), null);
});
