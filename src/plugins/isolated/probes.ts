import { launchIsolated } from './frame'

/**
 * Self-test of the frontier, run in the real WebView before any external plugin may start (spec
 * 4.2, principle 7: what is not demonstrated stays blocked). The battery is host-authored and runs
 * through exactly the same frame and Worker as a plugin. It reports "open" only when a forbidden
 * capability actually worked.
 */

export type ProbeOutcome = 'blocked' | 'open' | 'inconclusive'
export interface ProbeResult { name: string; outcome: ProbeOutcome; detail: string }
export interface IsolationReport {
  ok: boolean
  results: ProbeResult[]
  /** The host stayed responsive while a plugin spun forever, and removing its frame returned. */
  loop: { responsive: boolean; maxLagMs: number; stopMs: number }
  summary: string
}

const BATTERY = `
(function () {
  'use strict';
  var violations = [];
  self.addEventListener('securitypolicyviolation', function (event) { violations.push(event.effectiveDirective + ' ' + event.blockedURI); });
  function settle(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function result(name, outcome, detail) { return { name: name, outcome: outcome, detail: detail }; }

  // A network capability is "blocked" only when the policy says so; a plain failure could be an
  // offline machine and proves nothing.
  async function network(name, attempt) {
    var before = violations.length;
    try { await attempt(); return result(name, 'open', 'the request was allowed'); }
    catch (error) {
      await settle(50);
      return violations.length > before
        ? result(name, 'blocked', 'blocked by policy (' + violations[violations.length - 1] + ')')
        : result(name, 'inconclusive', 'failed without a policy violation: ' + (error && error.name));
    }
  }

  async function storage(name, attempt) {
    try { await attempt(); return result(name, 'open', 'storage is reachable'); }
    catch (error) { return result(name, 'blocked', String(error && error.name)); }
  }

  function globals() {
    var names = ['document', 'window', 'localStorage', 'sessionStorage', '__TAURI__', '__TAURI_INTERNALS__', '__TAURI_IPC__', 'parent', 'top', 'opener'];
    var present = names.filter(function (name) { return typeof self[name] !== 'undefined'; });
    return present.length ? result('host-globals', 'open', 'reachable: ' + present.join(', ')) : result('host-globals', 'blocked', 'none of ' + names.length + ' are defined');
  }

  async function runAll() {
    var out = [];
    out.push(globals());
    out.push(await network('fetch-remote', function () { return fetch('https://example.com/', { mode: 'no-cors' }); }));
    out.push(await network('fetch-tauri-ipc', function () { return fetch('http://ipc.localhost/list_external_plugins', { method: 'POST', body: '{}' }); }));
    out.push(await network('fetch-data-url', function () { return fetch('data:text/plain,probe'); }));
    out.push(await network('fetch-blob-url', function () { return fetch(URL.createObjectURL(new Blob(['probe']))); }));
    out.push(await network('xhr-remote', function () {
      return new Promise(function (resolve, reject) {
        var request = new XMLHttpRequest();
        request.onload = resolve; request.onerror = function () { reject(new Error('xhr')); };
        request.open('GET', 'https://example.com/'); request.send();
      });
    }));
    out.push(await network('websocket-remote', function () {
      return new Promise(function (resolve, reject) {
        var socket = new WebSocket('wss://example.com/');
        socket.onopen = resolve; socket.onerror = function () { reject(new Error('ws')); };
      });
    }));
    out.push(await network('import-scripts-remote', function () { importScripts('https://example.com/probe.js'); }));
    out.push(await storage('indexeddb', function () {
      return new Promise(function (resolve, reject) {
        var request = indexedDB.open('probe'); request.onsuccess = resolve; request.onerror = function () { reject(request.error); };
      });
    }));
    out.push(await storage('cache-storage', function () { return caches.open('probe'); }));
    return out;
  }

  self.addEventListener('message', function (event) {
    var port = event.ports && event.ports[0];
    if (!port) return;
    runAll().then(
      function (results) { port.postMessage({ type: 'probe-report', results: results }); },
      function (error) { port.postMessage({ type: 'probe-error', message: String(error && error.message) }); }
    );
  });
})();
`

const SPIN = `
self.addEventListener('message', function (event) {
  var port = event.ports && event.ports[0];
  if (!port) return;
  port.postMessage({ type: 'spinning' });
  for (;;) { /* never yields */ }
});
`

interface Session { messages: unknown[]; waitFor(type: string, ms: number): Promise<{ results?: unknown; message?: string } | null>; destroy(): void }

async function session(bootstrap: string): Promise<Session> {
  const messages: unknown[] = []
  const waiters: Array<() => void> = []
  const launched = await launchIsolated({
    bootstrap, source: '',
    onMessage: (data) => { messages.push(data); waiters.splice(0).forEach(wake => wake()) },
    onWorkerError: (message) => { messages.push({ type: 'worker-error', message }); waiters.splice(0).forEach(wake => wake()) },
  })
  return {
    messages,
    destroy: () => launched.destroy(),
    async waitFor(type, ms) {
      const deadline = performance.now() + ms
      for (;;) {
        const found = messages.find((item): item is { type: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === type)
        if (found) return found as { results?: unknown; message?: string }
        const left = deadline - performance.now()
        if (left <= 0) return null
        await new Promise<void>(resolve => { waiters.push(resolve); setTimeout(resolve, left) })
      }
    },
  }
}

function sane(value: unknown): ProbeResult[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const entry = item as Partial<ProbeResult>
    const outcome = entry.outcome
    return typeof entry.name === 'string' && (outcome === 'blocked' || outcome === 'open' || outcome === 'inconclusive')
      ? [{ name: entry.name.slice(0, 40), outcome, detail: String(entry.detail ?? '').slice(0, 160) }] : []
  })
}

const EXPECTED = 10

async function measureLoop(timeoutMs: number): Promise<IsolationReport['loop']> {
  const spin = await session(SPIN)
  try {
    if (!(await spin.waitFor('spinning', timeoutMs))) return { responsive: false, maxLagMs: Infinity, stopMs: Infinity }
    let maxLag = 0
    let last = performance.now()
    for (let tick = 0; tick < 8; tick += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
      const now = performance.now()
      maxLag = Math.max(maxLag, now - last - 50)
      last = now
    }
    const started = performance.now()
    spin.destroy()
    const stopMs = performance.now() - started
    return { responsive: maxLag < 250, maxLagMs: Math.round(maxLag), stopMs: Math.round(stopMs) }
  } finally {
    spin.destroy()
  }
}

export async function runIsolationProbes(timeoutMs = 8000): Promise<IsolationReport> {
  let results: ProbeResult[] = []
  const battery = await session(BATTERY)
  try {
    // The frame hands the Worker its channel; the battery answers on that same channel.
    const report = await battery.waitFor('probe-report', timeoutMs)
    results = sane(report?.results)
  } finally {
    battery.destroy()
  }
  const loop = await measureLoop(timeoutMs)
  const open = results.filter(item => item.outcome === 'open')
  const inconclusive = results.filter(item => item.outcome === 'inconclusive')
  const ok = results.length === EXPECTED && open.length === 0 && inconclusive.length === 0 && loop.responsive
  const summary = ok
    ? `All ${EXPECTED} isolation checks passed`
    : results.length !== EXPECTED
      ? 'The isolation self-test did not complete'
      : open.length
        ? `Isolation failed: ${open.map(item => item.name).join(', ')}`
        : inconclusive.length
          ? `Isolation could not be confirmed: ${inconclusive.map(item => item.name).join(', ')}`
          : 'The host was not responsive while a plugin was stuck in a loop'
  return { ok, results, loop, summary }
}
