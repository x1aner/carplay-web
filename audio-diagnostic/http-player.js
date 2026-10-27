/*! SPDX-License-Identifier: GPL-3.0-only */
// The existing URL can select this entry without changing the default RTC player.
document.documentElement.dataset.transport = 'http-video';
const url = new URL(window.location.href);
if (url.searchParams.has('diagnostic')) {
  url.searchParams.delete('diagnostic');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
await import('../app.js?v=84-perf3');
