/*! SPDX-License-Identifier: GPL-3.0-only */
import { viewportFor } from './link.js';

// One CarPlay surface for the Model 3 right pane, regardless of its temporary toolbar height. With the date header
// removed (`fill`) CarPlay takes the pane's real size instead, and a height change renegotiates its picture.
export function displayLayout(cssWidth, cssHeight, dpr, mode = 'carplay', { fill = false } = {}) {
  const raw = viewportFor(cssWidth, cssHeight, dpr);
  if (!raw) return null;
  const fixed = !fill && mode === 'carplay' && Math.abs(raw.w - 1184) <= 8 && raw.h >= 880 && raw.h <= 928;
  const height = fixed ? cssWidth * 880 / 1184 : cssHeight;
  const viewport = fixed ? { ...viewportFor(cssWidth, height, dpr), w: 1184, h: 880 } : raw;
  return { fixed, width: cssWidth, height, top: Math.max(0, cssHeight - height), viewport, raw };
}

// Width transitions animate through many sizes. Only the settled destination is negotiated.
export function createViewportReporter(send, { delay = 300, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null, last = null;
  const key = value => `${value.w}x${value.h}`;
  return {
    update(value) {
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (!value || key(value) === last) return;
      const publish = () => { timer = null; last = key(value); send(value); };
      if (last === null) publish();
      else timer = setTimer(publish, delay);
    },
    reset() { if (timer !== null) clearTimer(timer); timer = null; last = null; },
  };
}
