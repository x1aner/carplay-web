/*! SPDX-License-Identifier: GPL-3.0-only */
import { PAGE_BUILD } from './page-build.js';

/** page-build.json is published beside the page and kept out of the offline cache, so it names the live version. */
async function fetchPublishedBuild() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(new URL('page-build.json', import.meta.url), { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

/**
 * Compares this page with the published one: 'checking', 'current', 'available' (a newer page is published; the
 * browser installs it when the page is next opened) or 'offline' (not reachable, so not checked). Only the version
 * is compared: the offline cache updates when it changes, while a republish of the same version changes nothing.
 */
export function createPageFreshness({ fetchBuild = fetchPublishedBuild, onChange = () => {} } = {}) {
  let state = 'checking', latest = null, pending = null;
  const set = (next, version) => {
    if (next === state && version === latest) return;
    state = next; latest = version;
    onChange(state, latest);
  };
  return {
    state: () => state,
    latest: () => latest,
    check() {
      pending ??= fetchBuild().then(build => {
        const version = typeof build?.version === 'string' ? build.version : null;
        if (version) set(version === PAGE_BUILD.version ? 'current' : 'available', version);
        else set('offline', null);
      }, () => set('offline', latest)).finally(() => { pending = null; });
      return pending;
    },
  };
}
