import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createBridge, type Bridge, type HostCapabilities } from './bridge'
import { PERMISSIONS, type Permission } from './permissions'
import { LIMITS, parseWorkerMessage, type HostMessage } from './protocol'

const ALL = Object.keys(PERMISSIONS) as Permission[]
/** The plugin side sends JSON text only; this mirrors the bootstrap. */
const receive = (bridge: Bridge, data: unknown) => bridge.receive(typeof data === 'string' ? data : JSON.stringify(data))

function setup(granted: Permission[] = ALL, clock?: () => number) {
  let zoom = 1
  const guides = [{ id: 'g1', axis: 'row' as const, positionMm: 10 }]
  const capabilities: HostCapabilities = {
    getZoom: vi.fn(() => zoom),
    setZoom: vi.fn((value: number) => { zoom = value }),
    getGeometry: vi.fn(() => ({ pageWidthMm: 210, pageHeightMm: 297, zoom })),
    listGuides: vi.fn(() => guides),
    addGuide: vi.fn((axis, positionMm) => { guides.push({ id: `g${guides.length + 1}`, axis, positionMm }); return `g${guides.length}` }),
    removeGuide: vi.fn((id: string) => guides.some(guide => guide.id === id)),
  }
  const sent: HostMessage[] = []
  const hooks = { audit: vi.fn(), fault: vi.fn(), ready: vi.fn(), pong: vi.fn() }
  const bridge = createBridge({ granted, capabilities, send: message => sent.push(message), hooks, clock })
  const request = (id: number, op: string, args?: unknown) => ({ v: 1, kind: 'req', id, op, ...(args === undefined ? {} : { args }) })
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  return { bridge, capabilities, sent, hooks, request, settle }
}

describe('permission catalog', () => {
  it('matches the permissions the native installer accepts', () => {
    const source = readFileSync('src-tauri/src/plugin_package.rs', 'utf8')
    const block = /KNOWN_PERMISSIONS:[^=]*=\s*&\[([^\]]*)\]/.exec(source)?.[1] ?? ''
    expect([...block.matchAll(/"([^"]+)"/g)].map(match => match[1]).sort()).toEqual([...ALL].sort())
  })
})

describe('insert permission', () => {
  it('has a catalog entry but no worker operation can use it', () => {
    expect(PERMISSIONS['editor:insert'].label).toBe('Insert text you chose')
    for (const op of ['insert', 'insert.markdown', 'insertMarkdown', 'insertContent', 'editor.insert']) {
      const parsed = parseWorkerMessage({ v: 1, kind: 'req', id: 1, op, args: { markdown: 'hi' } })
      expect(parsed.ok, op).toBe(false)
    }
    const source = readFileSync('src/plugins/isolated/permissions.ts', 'utf8')
    expect(source.match(/OPERATION_PERMISSION[^}]*}/s)?.[0]).not.toContain('editor:insert')
    expect(source.match(/TOPIC_PERMISSION[^}]*}/s)?.[0]).not.toContain('editor:insert')
  })

  it('rejects an insert request from the worker as an unknown operation and never touches the host', async () => {
    const { bridge, capabilities, sent, settle } = setup()
    receive(bridge, { v: 1, kind: 'req', id: 1, op: 'insert.markdown', args: { markdown: '# hi' } })
    await settle()
    expect(Object.values(capabilities).every(fn => (fn as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true)
    expect(JSON.stringify(sent)).not.toContain('# hi')
  })
})

describe('protocol parsing', () => {
  const rejected = [
    ['a missing version', { kind: 'req', id: 1, op: 'zoom.get' }],
    ['a future version', { v: 2, kind: 'req', id: 1, op: 'zoom.get' }],
    ['a plugin supplied identity', { v: 1, kind: 'req', id: 1, op: 'zoom.get', pluginId: 'builtin.zoom' }],
    ['an identity inside args', { v: 1, kind: 'req', id: 1, op: 'zoom.get', args: { pluginId: 'x' } }],
    ['extra arguments', { v: 1, kind: 'req', id: 1, op: 'zoom.set', args: { value: 1, extra: true } }],
    ['a string zoom', { v: 1, kind: 'req', id: 1, op: 'zoom.set', args: { value: '2' } }],
    ['a zoom out of range', { v: 1, kind: 'req', id: 1, op: 'zoom.set', args: { value: 9 } }],
    ['NaN', { v: 1, kind: 'req', id: 1, op: 'zoom.set', args: { value: NaN } }],
    ['Infinity', { v: 1, kind: 'req', id: 1, op: 'guides.add', args: { axis: 'row', positionMm: Infinity } }],
    ['a bad axis', { v: 1, kind: 'req', id: 1, op: 'guides.add', args: { axis: 'diagonal', positionMm: 5 } }],
    ['a bad id', { v: 1, kind: 'req', id: 0, op: 'zoom.get' }],
    ['a fractional id', { v: 1, kind: 'req', id: 1.5, op: 'zoom.get' }],
    ['an array', []],
    ['null', null],
    ['a string', 'zoom.get'],
    ['a function-like op', { v: 1, kind: 'req', id: 1, op: 'invoke', args: { cmd: 'read_file' } }],
    ['an unknown topic', { v: 1, kind: 'req', id: 1, op: 'subscribe', args: { topic: 'document' } }],
    ['a class instance', new (class Evil { v = 1; kind = 'req'; id = 1; op = 'zoom.get' })()],
    ['an empty guide id', { v: 1, kind: 'req', id: 1, op: 'guides.remove', args: { guideId: '' } }],
    ['a pong with extras', { v: 1, kind: 'pong', n: 1, id: 3 }],
  ] as const
  it.each(rejected)('rejects %s', (_label, data) => {
    expect(parseWorkerMessage(data).ok).toBe(false)
  })

  it('accepts the closed set of operations', () => {
    const valid = [
      { v: 1, kind: 'req', id: 1, op: 'zoom.get' },
      { v: 1, kind: 'req', id: 2, op: 'zoom.set', args: { value: 1.5 } },
      { v: 1, kind: 'req', id: 3, op: 'guides.add', args: { axis: 'column', positionMm: 20 } },
      { v: 1, kind: 'req', id: 4, op: 'subscribe', args: { topic: 'zoom' } },
      { v: 1, kind: 'pong', n: 7 }, { v: 1, kind: 'ready' }, { v: 1, kind: 'fault', message: 'boom' },
    ]
    expect(valid.map(data => parseWorkerMessage(data).ok)).toEqual(valid.map(() => true))
  })

  it('does not walk an object with a huge number of keys', () => {
    const wide: Record<string, number> = {}
    for (let index = 0; index < 50_000; index += 1) wide[`k${index}`] = index
    const start = performance.now()
    expect(parseWorkerMessage({ v: 1, kind: 'req', id: 1, op: 'zoom.get', args: wide }).ok).toBe(false)
    expect(performance.now() - start).toBeLessThan(50)
  })
})

describe('bridge', () => {
  it('answers a granted request and applies it through the capability', async () => {
    const { bridge, sent, settle, request, capabilities } = setup()
    receive(bridge, request(1, 'zoom.set', { value: 2 }))
    receive(bridge, request(2, 'geometry.get'))
    await settle()
    expect(capabilities.setZoom).toHaveBeenCalledWith(2)
    expect(sent).toEqual([
      { v: 1, kind: 'res', id: 1, ok: true, result: 2 },
      { v: 1, kind: 'res', id: 2, ok: true, result: { pageWidthMm: 210, pageHeightMm: 297, zoom: 2 } },
    ])
  })

  it('rejects an operation whose permission was not granted, audits it and never touches the editor', async () => {
    const { bridge, sent, settle, request, capabilities, hooks } = setup(['editor:zoom:read'])
    receive(bridge, request(1, 'zoom.set', { value: 2 }))
    receive(bridge, request(2, 'guides.add', { axis: 'row', positionMm: 5 }))
    receive(bridge, request(3, 'zoom.get'))
    await settle()
    expect(capabilities.setZoom).not.toHaveBeenCalled()
    expect(capabilities.addGuide).not.toHaveBeenCalled()
    expect(sent.map(message => message.kind === 'res' && message.ok)).toEqual([false, false, true])
    expect(hooks.audit).toHaveBeenCalledWith('permission_denied', 'zoom.set needs editor:zoom:write')
  })

  it('treats every guide operation as needing its own permission', async () => {
    const { bridge, sent, settle, request } = setup(['editor:guides:read'])
    receive(bridge, request(1, 'guides.list'))
    receive(bridge, request(2, 'guides.remove', { guideId: 'g1' }))
    await settle()
    expect(sent.map(message => message.kind === 'res' && message.ok)).toEqual([true, false])
  })

  it('drops work that was received before close() and never applies it', async () => {
    const { bridge, sent, settle, request, capabilities } = setup()
    receive(bridge, request(1, 'zoom.set', { value: 2 }))
    bridge.close()
    await settle()
    expect(capabilities.setZoom).not.toHaveBeenCalled()
    expect(sent).toEqual([])
    receive(bridge, request(2, 'zoom.set', { value: 2 }))
    bridge.emit('zoom')
    bridge.command('x', null)
    await settle()
    expect(capabilities.setZoom).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('answers malformed requests with an error when the id is usable and counts them', async () => {
    const { bridge, sent, request } = setup()
    receive(bridge, request(5, 'zoom.set', { value: 'big' }))
    receive(bridge, { junk: true })
    expect(sent).toEqual([{ v: 1, kind: 'res', id: 5, ok: false, error: { code: 'invalid_arguments', message: 'Invalid arguments for zoom.set' } }])
  })

  it('stops the plugin at the first message that is not bounded JSON text', () => {
    const oversized = setup()
    receive(oversized.bridge, { v: 1, kind: 'fault', message: 'x'.repeat(LIMITS.messageBytes + 1) })
    expect(oversized.hooks.fault).toHaveBeenCalledWith('message larger than the limit', true)
    expect(oversized.bridge.closed).toBe(true)

    for (const payload of [{ v: 1, kind: 'ready' }, new Array(1000).fill(1.5), 42, null]) {
      const live = setup()
      live.bridge.receive(payload)
      expect(live.hooks.fault).toHaveBeenCalledWith('non-text message', true)
      expect(live.bridge.closed).toBe(true)
    }
    const broken = setup()
    broken.bridge.receive('{"v":1,')
    expect(broken.hooks.fault).toHaveBeenCalledWith('message is not valid JSON', true)
  })

  it('reads a just-under-limit message without stopping the plugin', () => {
    const { bridge, hooks } = setup()
    receive(bridge, { v: 1, kind: 'fault', message: 'x'.repeat(LIMITS.messageBytes - 100) })
    expect(hooks.fault).toHaveBeenCalledWith('plugin reported an unhandled error', false)
    expect(bridge.closed).toBe(false)
  })

  it('rate limits per second and recovers in the next window', async () => {
    let now = 0
    const { bridge, sent, settle, request } = setup(ALL, () => now)
    for (let id = 1; id <= LIMITS.perSecond + 5; id += 1) {
      receive(bridge, request(id, 'zoom.get'))
      if (id % 10 === 0) await settle()
    }
    await settle()
    const limited = sent.filter(message => message.kind === 'res' && !message.ok)
    expect(limited).toHaveLength(5)
    expect(limited.every(message => message.kind === 'res' && !message.ok && message.error.code === 'rate_limited')).toBe(true)
    now = 1500
    receive(bridge, request(500, 'zoom.get'))
    await settle()
    expect(sent.at(-1)).toMatchObject({ id: 500, ok: true })
  })

  it('limits requests waiting for an answer', async () => {
    const { bridge, sent, settle, request } = setup(ALL, () => 0)
    for (let id = 1; id <= LIMITS.pending + 4; id += 1) receive(bridge, request(id, 'zoom.get'))
    await settle()
    const busy = sent.filter(message => message.kind === 'res' && !message.ok && message.error.code === 'busy')
    expect(busy).toHaveLength(4)
  })

  it('stops the plugin after repeated rejected messages', () => {
    const { bridge, hooks } = setup()
    for (let index = 0; index < LIMITS.violations; index += 1) receive(bridge, { garbage: index })
    expect(hooks.fault).toHaveBeenCalledTimes(1)
    expect(bridge.closed).toBe(true)
  })

  it('pushes events only for subscribed topics the plugin may read', async () => {
    const { bridge, sent, settle, request } = setup(['editor:zoom:read'])
    bridge.emit('zoom')
    expect(sent).toEqual([])
    receive(bridge, request(1, 'subscribe', { topic: 'zoom' }))
    receive(bridge, request(2, 'subscribe', { topic: 'guides' }))
    await settle()
    sent.length = 0
    bridge.emit('zoom')
    bridge.emit('guides')
    expect(sent).toEqual([{ v: 1, kind: 'event', topic: 'zoom', data: { zoom: 1 } }])
  })

  it('reports heartbeat, readiness and a plugin fault to the host', () => {
    const { bridge, hooks } = setup()
    receive(bridge, { v: 1, kind: 'pong', n: 4 })
    receive(bridge, { v: 1, kind: 'ready' })
    receive(bridge, { v: 1, kind: 'fault', message: 'TypeError: x' })
    expect(hooks.pong).toHaveBeenCalledWith(4)
    expect(hooks.ready).toHaveBeenCalledTimes(1)
    expect(hooks.fault).toHaveBeenCalledTimes(1)
  })

  it('does not leak a failing capability to the plugin', async () => {
    const { bridge, sent, settle, request, capabilities } = setup()
    vi.mocked(capabilities.getZoom).mockImplementation(() => { throw new Error('C:\\secret\\path') })
    receive(bridge, request(1, 'zoom.get'))
    await settle()
    expect(JSON.stringify(sent)).not.toContain('secret')
    expect(sent[0]).toMatchObject({ ok: false, error: { code: 'failed' } })
  })
})
