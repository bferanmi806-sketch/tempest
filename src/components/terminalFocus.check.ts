import assert from "node:assert/strict";
import { createFitScheduler, shouldFullRefresh, shouldSendResize } from "../lib/terminalFocusPolicy.ts";

// Ordinary focus with unchanged dims sends nothing: the restore path must not
// pay an IPC round-trip plus PTY resize and shell repaint for zero change.
assert.equal(shouldSendResize({ rows: 24, cols: 80 }, { rows: 24, cols: 80 }, false), false);
// First fit always asserts so the backend learns the size (initial font fit).
assert.equal(shouldSendResize(null, { rows: 24, cols: 80 }, false), true);
// Real resizes still go through on either axis.
assert.equal(shouldSendResize({ rows: 24, cols: 80 }, { rows: 25, cols: 80 }, false), true);
assert.equal(shouldSendResize({ rows: 24, cols: 80 }, { rows: 24, cols: 81 }, false), true);
// While a phone drives the session the backend owns dims: never send, even changed.
assert.equal(shouldSendResize(null, { rows: 24, cols: 80 }, true), false);
assert.equal(shouldSendResize({ rows: 24, cols: 80 }, { rows: 30, cols: 100 }, true), false);

// Restore genuinely needs a repaint only after content may have been dropped.
assert.equal(shouldFullRefresh(true), true, "minimize/tab-switch restore repaints");
assert.equal(shouldFullRefresh(false), false, "ordinary refocus keeps painted rows");

// Restore callbacks coalesce: concurrent focus + unhide + relayout claim one slot.
const scheduler = createFitScheduler();
assert.equal(scheduler.claim(), true, "first claimant schedules");
assert.equal(scheduler.claim(), false, "second claimant coalesces");
assert.equal(scheduler.claim(), false, "third claimant coalesces");
scheduler.release();
assert.equal(scheduler.claim(), true, "next restore window schedules again");
scheduler.release();

// End-to-end policy simulation: ten refocuses with unchanged dims, one real
// resize, then ten more — exactly one IPC for the whole sequence.
let sent: Array<{ rows: number; cols: number }> = [];
let lastSent: { rows: number; cols: number } | null = null;
const dims = { rows: 24, cols: 80 };
for (let i = 0; i < 10; i++) {
  if (shouldSendResize(lastSent, dims, false)) {
    sent.push({ ...dims });
    lastSent = { ...dims };
  }
}
assert.equal(sent.length, 1, "first fit asserts, rest are skipped");
const grown = { rows: 30, cols: 80 };
if (shouldSendResize(lastSent, grown, false)) {
  sent.push({ ...grown });
  lastSent = { ...grown };
}
for (let i = 0; i < 10; i++) {
  if (shouldSendResize(lastSent, grown, false)) {
    sent.push({ ...grown });
    lastSent = { ...grown };
  }
}
assert.deepEqual(sent, [dims, grown], "exactly one IPC per distinct size");

// Cleanup releases the slot so a later mount is never stuck coalesced.
const cleanup = createFitScheduler();
assert.equal(cleanup.claim(), true);
cleanup.release();
assert.equal(cleanup.claim(), true, "unmount cleanup frees the pending slot");

console.log("terminalFocus: all checks passed");
