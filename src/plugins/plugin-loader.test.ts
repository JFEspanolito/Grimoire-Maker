import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { evaluatePluginPackage, readPluginPackage, reconcilePlugins } from './plugin-loader'
import { registerPlugin, unregisterPlugin, usePluginRegistry } from './plugin-manager'
import { MOD_KIND, type ModEntry, type ModFs } from '../lib/modCatalog'

function memoryFs(files: Record<string, string>): ModFs {
  return {
    exists: async path => Object.keys(files).some(file => file === path || file.startsWith(`${path}/`)),
    mkdir: async () => {}, writeTextFile: async () => {},
    readTextFile: vi.fn(async path => { if (!(path in files)) throw new Error(`Missing ${path}`); return files[path] }),
    stat: async path => ({ size: new TextEncoder().encode(files[path] ?? '').length }),
    readDir: async path => {
      const entries = new Map<string, boolean>()
      for (const file of Object.keys(files)) if (file.startsWith(`${path}/`)) {
        const relative = file.slice(path.length + 1)
        const name = relative.split('/')[0]
        entries.set(name, relative.includes('/'))
      }
      return [...entries].map(([name, isDirectory]) => ({ name, isDirectory }))
    },
  }
}
const mod = (folder: string, enabled = true): ModEntry => ({ id: `Plugins/${folder.split('/').at(-1)}`, kind: MOD_KIND.PLUGINS, label: folder, folder, enabled, errors: [] })
const source = (id: string, body = '') => `export default { id: '${id}', name: '${id}', version: '1', activate(api) { ${body} } }`

it('accepts a capitalized TSX entry matching its folder alongside a helper script', async () => {
  const pkg = await readPluginPackage(memoryFs({
    '/plugins/zoom/Zoom.tsx': source('capitalized'), '/plugins/zoom/script.ts': 'export const value = 1',
  }), '/plugins/zoom')
  expect(pkg.entry).toBe('Zoom.tsx')
  expect((await evaluatePluginPackage(pkg)).id).toBe('capitalized')
})
afterEach(async () => {
  await reconcilePlugins(memoryFs({}), [])
  for (const plugin of usePluginRegistry.getState().plugins) unregisterPlugin(plugin.id)
  Reflect.deleteProperty(globalThis, '__pluginEvaluations')
})

it('transpiles TSX with relative TypeScript, scoped CSS and the host React hooks', async () => {
  const io = memoryFs({
    '/plugins/demo/demo.tsx': `import { useState } from 'react'; import { label } from './script'; import styles from './style.module.css';
      function Control() { const [count,setCount] = useState(0); return <button className={styles.control} onClick={() => setCount(count+1)}>{label}: {count}</button> }
      export default { id:'demo', name:'Demo', version:'1', activate(api) { api.registerToolbar({id:'demo-control',title:'Demo',component:Control}) } }`,
    '/plugins/demo/script.ts': `export const label: string = 'Clicks'`,
    '/plugins/demo/style.module.css': '.control:hover { color: red; background: url("./art.png"); }',
  })
  const pkg = await readPluginPackage(io, '/plugins/demo')
  const plugin = await evaluatePluginPackage(pkg)
  expect(document.querySelector('[data-plugin-style]')).toBeNull()
  registerPlugin(plugin)
  const host = document.createElement('div')
  const root = createRoot(host)
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  try {
    const Control = usePluginRegistry.getState().toolbar[0].component
    await act(async () => root.render(createElement(Control)))
    expect(host.textContent).toBe('Clicks: 0')
    await act(async () => host.querySelector('button')!.click())
    expect(host.textContent).toBe('Clicks: 1')
    expect(host.querySelector('button')!.className).not.toBe('control')
    const css = document.querySelector('[data-plugin-style="demo"]')!.textContent!
    expect(css).toContain(host.querySelector('button')!.className)
    expect(css).toContain('./art.png')
  } finally { await act(async () => root.unmount()) }
})

it('supports JS entry points, rejects syntax and unresolved imports, and keeps reads in the package', async () => {
  const io = memoryFs({ '/p/js/index.js': source('js'), '/p/bad/index.ts': 'const broken = ;', '/p/escape/index.ts': `import '../outside'; ${source('escape')}`, '/p/amb/a.ts': '', '/p/amb/b.ts': '' })
  expect((await evaluatePluginPackage(await readPluginPackage(io, '/p/js'))).id).toBe('js')
  await expect(evaluatePluginPackage(await readPluginPackage(io, '/p/bad'))).rejects.toThrow()
  await expect(evaluatePluginPackage(await readPluginPackage(io, '/p/escape'))).rejects.toThrow('outside')
  await expect(readPluginPackage(io, '/p/amb')).rejects.toThrow('entry')
})

it('never evaluates disabled plugins, caches unchanged sources and unloads changed/deleted packages', async () => {
  const files = { '/p/demo/index.ts': `globalThis.__pluginEvaluations = (globalThis.__pluginEvaluations || 0)+1; ${source('demo', "api.registerCommand({id:'one',label:'One',run(){}})")}` }
  const io = memoryFs(files)
  await reconcilePlugins(io, [mod('/p/demo', false)])
  expect(io.readTextFile).not.toHaveBeenCalled()
  await reconcilePlugins(io, [mod('/p/demo')])
  await reconcilePlugins(io, [mod('/p/demo')])
  expect(Reflect.get(globalThis, '__pluginEvaluations')).toBe(1)
  files['/p/demo/index.ts'] = source('demo', "api.registerCommand({id:'two',label:'Two',run(){}})")
  await reconcilePlugins(io, [mod('/p/demo')])
  expect(usePluginRegistry.getState().commands.map(command => command.id)).toEqual(['two'])
  await reconcilePlugins(io, [mod('/p/demo', false)])
  expect(usePluginRegistry.getState().plugins).toHaveLength(0)
  await reconcilePlugins(io, [mod('/p/demo')])
  await reconcilePlugins(io, [])
  expect(usePluginRegistry.getState().plugins).toHaveLength(0)
})

it('isolates compile/activation errors and rejects linked entries', async () => {
  const io = memoryFs({ '/p/fail/index.ts': source('fail', "api.registerCommand({id:'bad',label:'Bad',run(){}}); throw new Error('oops')"), '/p/good/index.ts': source('good') })
  const errors = await reconcilePlugins(io, [mod('/p/fail'), mod('/p/good')])
  expect(errors.join(' ')).toContain('oops')
  expect(usePluginRegistry.getState().plugins.map(plugin => plugin.id)).toEqual(['good'])
  expect(usePluginRegistry.getState().commands).toHaveLength(0)
  const linked = { ...io, readDir: async () => [{ name: 'index.ts', isDirectory: false, isSymlink: true }] }
  await expect(readPluginPackage(linked, '/linked')).rejects.toThrow('link')
})

it('bounds source reads and rejects unsupported dependencies without retaining contributions', async () => {
  const oversized = memoryFs({ '/p/large/index.ts': 'x'.repeat(512 * 1024 + 1) })
  await expect(readPluginPackage(oversized, '/p/large')).rejects.toThrow('512 KiB')
  expect(oversized.readTextFile).not.toHaveBeenCalled()
  const io = memoryFs({ '/p/bad/index.ts': `import 'arbitrary-npm-package'; ${source('bad')}` })
  await expect(evaluatePluginPackage(await readPluginPackage(io, '/p/bad'))).rejects.toThrow('Unsupported plugin import')
  expect(usePluginRegistry.getState().plugins).toHaveLength(0)
})
