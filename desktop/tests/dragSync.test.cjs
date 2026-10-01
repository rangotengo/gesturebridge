const test = require('node:test');
const assert = require('node:assert/strict');

const { HeldButtonTracker } = require('../dist/security.js');

test('HeldButtonTracker tracks pressed buttons and ignores redundant presses', () => {
  const tracker = new HeldButtonTracker();
  assert.equal(tracker.size(), 0);
  assert.equal(tracker.has('left'), false);

  tracker.press('left');
  assert.equal(tracker.size(), 1);
  assert.equal(tracker.has('left'), true);

  // Redundant press does not duplicate
  tracker.press('left');
  assert.equal(tracker.size(), 1);

  tracker.press('right');
  assert.equal(tracker.size(), 2);
  assert.equal(tracker.has('right'), true);
});

test('HeldButtonTracker releases individual buttons correctly', () => {
  const tracker = new HeldButtonTracker();
  tracker.press('left');
  tracker.press('right');

  assert.equal(tracker.release('left'), true);
  assert.equal(tracker.size(), 1);
  assert.equal(tracker.has('left'), false);
  assert.equal(tracker.has('right'), true);

  // Releasing already released button returns false
  assert.equal(tracker.release('left'), false);
  assert.equal(tracker.size(), 1);
});

test('HeldButtonTracker releaseAll returns released buttons with reason and resets state', () => {
  const tracker = new HeldButtonTracker();

  // Releasing when empty returns null
  assert.equal(tracker.releaseAll('deadman-timeout'), null);

  tracker.press('left');
  tracker.press('right');

  const releaseResult = tracker.releaseAll('deadman-timeout');
  assert.ok(releaseResult);
  assert.equal(releaseResult.reason, 'deadman-timeout');
  assert.equal(releaseResult.buttons.length, 2);
  assert.ok(releaseResult.buttons.includes('left'));
  assert.ok(releaseResult.buttons.includes('right'));

  // Tracker is now empty
  assert.equal(tracker.size(), 0);
  assert.equal(tracker.has('left'), false);
  assert.equal(tracker.has('right'), false);

  // Subsequent release returns null
  assert.equal(tracker.releaseAll('emergency-stop'), null);
});
