/**
 * The execution frontier: a sandboxed iframe (opaque origin, no same-origin, no navigation, no
 * forms, no popups) whose document carries a locked-down CSP and does one thing: start a blob
 * Worker running host-supplied bootstrap code followed by the plugin bundle. Plugin code only ever
 * runs in that Worker, which has no DOM and inherits the CSP (`connect-src 'none'`).
 *
 * The host talks to the Worker over a private MessageChannel. Stopping a plugin removes the
 * iframe, which destroys the Worker even if it is stuck in a loop.
 */

const FRAME_SCRIPT = `
(function () {
  'use strict';
  var started = false;
  function report(type, message) {
    window.parent.postMessage({ type: type, message: String(message || '').slice(0, 200) }, '*');
  }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (started || event.source !== window.parent) return;
    if (!data || data.type !== 'start' || typeof data.bootstrap !== 'string' || typeof data.source !== 'string') return;
    if (!event.ports || event.ports.length !== 1) return;
    started = true;
    try {
      var blob = new Blob([data.bootstrap, '\\n;\\n', data.source], { type: 'text/javascript' });
      var worker = new Worker(URL.createObjectURL(blob));
      worker.onerror = function (error) { error.preventDefault(); report('worker-error', error.message || 'Worker failed to start'); };
      worker.postMessage({ type: 'init' }, [event.ports[0]]);
    } catch (error) {
      report('worker-error', error && error.message);
    }
  });
  report('frame-ready', '');
})();
`

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Everything is denied except running the one inline script and starting blob Workers. */
export function frameCsp(scriptHash: string): string {
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}' blob:`,
    'worker-src blob:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

export async function buildFrameDocument(): Promise<string> {
  const csp = frameCsp(await sha256Base64(FRAME_SCRIPT))
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${FRAME_SCRIPT}</script>`
}

export interface LaunchOptions {
  bootstrap: string
  source: string
  /** Receives every message the Worker posts on the private channel. */
  onMessage(data: unknown): void
  /** The frame reported a start failure (syntax error, top-level throw). Text only, untrusted. */
  onWorkerError(message: string): void
}

export interface Launched {
  post(message: unknown): void
  /** Removes the iframe and closes the channel. Safe to call more than once. */
  destroy(): void
  readonly destroyed: boolean
}

/** Creates the frame; once it reports ready, hands the Worker its private channel. */
export async function launchIsolated(options: LaunchOptions): Promise<Launched> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none'
  iframe.srcdoc = await buildFrameDocument()

  const channel = new MessageChannel()
  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    window.removeEventListener('message', onFrameMessage)
    channel.port1.onmessage = null
    channel.port1.close()
    iframe.remove()
  }
  // Only this frame's window is listened to, and only two fixed message types are understood.
  function onFrameMessage(event: MessageEvent) {
    if (destroyed || event.source !== iframe.contentWindow) return
    const data = event.data as { type?: unknown; message?: unknown } | null
    if (data?.type === 'worker-error') options.onWorkerError(typeof data.message === 'string' ? data.message.slice(0, 200) : '')
    else if (data?.type === 'frame-ready') startWorker()
  }
  let started = false
  function startWorker() {
    if (started || destroyed) return
    started = true
    iframe.contentWindow?.postMessage({ type: 'start', bootstrap: options.bootstrap, source: options.source }, '*', [channel.port2])
  }

  window.addEventListener('message', onFrameMessage)
  channel.port1.onmessage = (event) => { if (!destroyed) options.onMessage(event.data) }
  document.body.append(iframe)
  return {
    post: (message) => { if (!destroyed) channel.port1.postMessage(message) },
    destroy,
    get destroyed() { return destroyed },
  }
}
