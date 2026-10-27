/*! SPDX-License-Identifier: GPL-3.0-only */
import { videoLimit } from './playback-window.js';

/** Submit at display refresh while preserving the raw presentation deadline. */
export function createVideoFramePacer(present, {
  now = () => performance.timeOrigin + performance.now(),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  schedule = setTimeout, cancel = clearTimeout, budget = () => 4,
  maxPendingFrames = 1,
} = {}) {
  let pending = [], animation = null, timer = null, timerAt = null, epoch = null, mode = null;
  let dropped = 0, refreshes = 0, deadlines = 0;
  const cancelPending = () => {
    if (animation !== null) cancelFrame?.(animation);
    if (timer !== null) cancel(timer);
    animation = timer = timerAt = null;
  };
  const release = () => { for (const item of pending) item.frame.close(); pending = []; };
  function flush(reason) {
    cancelPending();
    const next = pending.shift();
    if (!next) return;
    if (reason === 'refresh') refreshes++;
    else if (reason === 'deadline') deadlines++;
    present(next.frame, next.config, next.timing, next.outputWindow, reason);
    arm();
  }
  function arm() {
    const next = pending[0];
    if (!next) return;
    if (!requestFrame) { flush('immediate'); return; }
    const deadline = Math.min(Number.isFinite(next.timing) ? next.timing + videoLimit(next.config?.mode) : Infinity,
      Number.isFinite(next.outputWindow?.latest) ? next.outputWindow.latest : Infinity);
    const at = now(), due = deadline - Math.max(2, budget()), wait = due - at;
    if (wait <= 0) { flush('deadline'); return; }
    if (animation === null) {
      try { animation = requestFrame(() => { animation = null; flush('refresh'); }); }
      catch (_) { requestFrame = null; flush('immediate'); return; }
    }
    // Newer frames normally move the deadline forward. Reuse the earlier guard
    // instead of allocating/cancelling a timer at the source frame rate. When it
    // wakes, arm() checks the current picture's deadline before submitting it.
    if (timer !== null && timerAt <= due) return;
    if (timer !== null) cancel(timer);
    timer = timerAt = null;
    if (Number.isFinite(wait)) {
      timerAt = due;
      timer = schedule(() => { timer = timerAt = null; arm(); }, wait);
    }
  }
  return {
    present(frame, config, timing, outputWindow) {
      if (epoch !== config?.epoch || mode !== config?.mode) {
        cancelPending(); release();
        epoch = config?.epoch; mode = config?.mode; dropped = refreshes = deadlines = 0;
      }
      // At 60fps two successive frames can straddle the same refresh because of
      // sub-frame delivery jitter. One extra slot preserves that cadence; large
      // bursts still drop the oldest frame and cannot grow an unbounded queue.
      const frameBytes = (frame.codedWidth ?? config?.width ?? 0) * (frame.codedHeight ?? config?.height ?? 0) * 4;
      const limit = config?.mode === 'carplay' && config?.fps >= 50 && frameBytes <= 8 * 1024 * 1024 && maxPendingFrames >= 2 ? 2 : 1;
      pending.push({ frame, config, timing, outputWindow });
      while (pending.length > limit) { pending.shift().frame.close(); dropped++; }
      arm();
    },
    reset() {
      cancelPending(); release();
      epoch = mode = null; dropped = refreshes = deadlines = 0;
    },
    stats: () => ({ pacingMode: requestFrame ? 'display-refresh' : 'immediate', pacingDroppedFrames: dropped,
      pacingRefreshDraws: refreshes, pacingDeadlineDraws: deadlines, pacingQueuedFrames: pending.length }),
  };
}
