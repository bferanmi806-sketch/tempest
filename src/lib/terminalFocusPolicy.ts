// Pure policy for terminal focus/restore work (issue #28).
// Kept free of DOM/xterm so the self-check suite can exercise it in bare node.
// TerminalPane.tsx owns the rAF chains and IPC; it asks here whether each step
// is warranted so an idle refocus does no redundant work on low-end systems.

export interface PtyDims {
  rows: number;
  cols: number;
}

/**
 * True when a resize_pty IPC is warranted: first fit, changed dims, or
 * reassertion after an external size change (e.g. mobile handoff, which clears
 * the cache). Never while mobile-driven (the backend owns dims then) and never
 * when dims are unchanged — the backend resize + shell repaint is the most
 * expensive step on the restore path.
 */
export function shouldSendResize(
  lastSent: PtyDims | null,
  current: PtyDims,
  mobileControlled: boolean,
): boolean {
  if (mobileControlled) return false;
  if (lastSent === null) return true;
  return lastSent.rows !== current.rows || lastSent.cols !== current.cols;
}

/**
 * A full-row repaint is only required when rendered content may have been
 * dropped while hidden (minimize / tab switch). Plain refocus keeps already
 * painted rows, so repainting them is pure cost.
 */
export function shouldFullRefresh(wasHidden: boolean): boolean {
  return wasHidden;
}

/**
 * Coalesces redundant restore callbacks: the first claimant wins until the
 * scheduled fit runs. Prevents focus + unhide + relayout from queueing
 * duplicate fit/IPC/refresh chains on the same frame window.
 */
export function createFitScheduler() {
  let pending = false;
  return {
    /** True when the caller should schedule the rAF chain; false when one is already queued. */
    claim(): boolean {
      if (pending) return false;
      pending = true;
      return true;
    },
    release(): void {
      pending = false;
    },
  };
}
