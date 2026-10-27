/*! SPDX-License-Identifier: GPL-3.0-only */

/** Do not even load the output module until the authenticated phone explicitly permits browser audio. */
export function createAudioOutputGate(options, {
  load = () => import('./audio.js').then(module => module.createBrowserAudio),
  mediaSession = globalThis.navigator?.mediaSession,
} = {}) {
  let allowed = false, disposed = false, output = null, loading = null, generation = 0, moduleLoaded = false;
  let currentStatus = { audio: false }, currentClock = null, connection = null, failure = null, debug = false;
  const delays = new Map();
  function release() {
    generation++;
    output?.dispose(); output = null; loading = null;
    releaseMediaState();
  }
  function ensure() {
    if (disposed || !allowed) return Promise.resolve(null);
    if (output) return Promise.resolve(output);
    if (loading) return loading;
    const owner = generation;
    const task = Promise.resolve().then(load).then(create => {
      moduleLoaded = true;
      if (disposed || !allowed || generation !== owner) return null;
      const next = output = create({ ...options, outputEnabled: true });
      next.clock(currentClock); next.debug(debug);
      for (const [mode, plan] of delays) next.delay(plan, mode);
      next.status(currentStatus);
      if (connection && !connection.signal.aborted) next.attach(connection.signal, connection.hello, connection.openMedia);
      failure = null;
      return next;
    }).catch(error => {
      if (generation === owner && allowed && !disposed) failure = error.message;
      return null;
    }).finally(() => { if (loading === task) loading = null; });
    loading = task;
    return task;
  }
  return {
    stats: () => ({ supported: connection?.hello.audio === true, enabled: allowed, sound: false,
      contextAllocated: false, queuedBytes: 0, error: failure, ...output?.stats(), moduleLoaded,
      probeSkipped: !allowed }),
    activate: () => ensure().then(next => next?.activate()),
    start() { void ensure(); },
    gesture() { if (output) output.gesture(); else void ensure(); },
    clock(value) { currentClock = value; output?.clock(value); },
    delay(value, mode) { delays.set(mode, value); output?.delay(value, mode); },
    debug(value) { debug = value; output?.debug(value); },
    reset() { output?.reset(); },
    attach(signal, hello, openMedia) {
      connection = { signal, hello, openMedia };
      if (output) output.attach(signal, hello, openMedia); else void ensure();
    },
    status(value) {
      currentStatus = value;
      // Missing policy never enables output before authentication.
      if (typeof value.audio === 'boolean') allowed = value.audio;
      if (!allowed) { if (output || loading) release(); else releaseMediaState(); }
      else if (output) output.status(value);
      else void ensure();
    },
    stop() { connection = null; allowed = false; release(); },
    dispose() { disposed = true; connection = null; allowed = false; release(); },
  };
  function releaseMediaState() {
    try {
      if (mediaSession?.playbackState && mediaSession.playbackState !== 'none') mediaSession.playbackState = 'none';
      if (mediaSession?.metadata) mediaSession.metadata = null;
    } catch (_) {}
  }
}
