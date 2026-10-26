import type { GrimoirePlugin } from '../types/plugin'
import { MOD_KIND, type ModEntry, type ModFs } from '../lib/modCatalog'
import { registerPlugin, unregisterPlugin, usePluginRegistry } from './plugin-manager'

export interface PluginPackage { entry: string; files: Record<string, string>; fingerprint: string }
interface LoadedPlugin { folder: string; fingerprint: string; pluginId: string }
interface CommonJsModule { exports: Record<string, unknown> }
const loaded = new Map<string, LoadedPlugin>()
const CODE = /\.(tsx?|js)$/i
const EXTENSIONS = ['.tsx', '.ts', '.js']
const MAX_FILE_BYTES = 512 * 1024
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Snapshot local source only. Discovery and disabled packages never run code. */
export async function readPluginPackage(io: ModFs, folder: string): Promise<PluginPackage> {
  const files: Record<string, string> = Object.create(null)
  let count = 0
  let bytes = 0
  const walk = async (directory: string, relative: string, depth: number): Promise<void> => {
    if (depth > 8) throw new Error('Plugin folders exceed eight nested levels')
    for (const file of (await io.readDir(directory)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (file.name.startsWith('.')) continue
      if (++count > 128) throw new Error('Plugin exceeds 128 entries')
      if (!file.name || /[\\/:]/.test(file.name) || file.name === '..') throw new Error('Invalid plugin filename')
      if (file.isSymlink) throw new Error(`Plugin links are not supported: ${file.name}`)
      const name = `${relative}${file.name}`
      const path = `${directory}/${file.name}`
      if (file.isDirectory) { await walk(path, `${name}/`, depth + 1); continue }
      if ((!CODE.test(name) && !name.endsWith('.css')) || name.endsWith('.d.ts')) continue
      const info = await io.stat(path)
      if (info.size > MAX_FILE_BYTES || info.size < 0) throw new Error(`Plugin file exceeds 512 KiB: ${name}`)
      const text = await io.readTextFile(path)
      const size = new TextEncoder().encode(text).length
      if (size > MAX_FILE_BYTES) throw new Error(`Plugin file exceeds 512 KiB: ${name}`)
      bytes += size
      if (bytes > MAX_PACKAGE_BYTES) throw new Error('Plugin source exceeds 4 MiB')
      files[name] = text
    }
  }
  const normalizedFolder = folder.replaceAll('\\', '/').replace(/\/+$/, '')
  await walk(normalizedFolder, '', 0)
  const stem = normalizedFolder.split('/').at(-1)!
  const rootCode = Object.keys(files).filter(name => !name.includes('/') && CODE.test(name))
  const entry = [...EXTENSIONS.map(ext => `index${ext}`), ...EXTENSIONS.map(ext => `${stem}${ext}`)]
    .map(candidate => rootCode.find(name => name.toLowerCase() === candidate.toLowerCase())).find(Boolean)
    ?? (rootCode.length === 1 ? rootCode[0] : undefined)
  if (!entry) throw new Error('Plugin needs an unambiguous entry: index.tsx, index.ts, index.js, or a file matching its folder name')
  return { entry, files, fingerprint: JSON.stringify([entry, files]) }
}

function resolveRelative(from: string, specifier: string, files: Record<string, string>): string {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(`Unsupported plugin import: ${specifier}`)
  if (specifier.includes('\\') || /[?#:]/.test(specifier)) throw new Error(`Unsupported plugin import: ${specifier}`)
  const segments = from.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.' || !part) continue
    if (part === '..') {
      if (!segments.length) throw new Error(`Plugin import is outside its package: ${specifier}`)
      segments.pop()
    } else segments.push(part)
  }
  const path = segments.join('/')
  const candidates = [path, ...EXTENSIONS.map(ext => path + ext), ...EXTENSIONS.map(ext => `${path}/index${ext}`)]
  if (path.endsWith('.js')) candidates.push(path.slice(0, -3) + '.ts', path.slice(0, -3) + '.tsx')
  const resolved = candidates.find(candidate => Object.hasOwn(files, candidate))
  if (!resolved) throw new Error(`Cannot resolve plugin import ${specifier} from ${from}`)
  return resolved
}

function cssModule(source: string, identity: string): { css: string; classes: Record<string, string> } {
  let hash = 2166136261
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  const prefix = `plugin_${(hash >>> 0).toString(36)}_`
  const classes: Record<string, string> = Object.create(null)
  // Rewrite selectors only; declarations, URLs and fractional lengths remain intact.
  const css = source.replace(/([^{}]+)\{/g, (_match, selector: string) => `${selector.replace(/\.([_a-zA-Z][\w-]*)/g,
    (_class, name: string) => `.${classes[name] ??= `${prefix}${name}`}`)}{`)
  return { css, classes }
}

/** Trusted code executes in this WebView. Import resolution is not a sandbox. */
export async function evaluatePluginPackage(pkg: PluginPackage): Promise<GrimoirePlugin> {
  const [ts, react, reactDom, jsx, zustand, sdk] = await Promise.all([
    import('typescript'), import('react'), import('react-dom'), import('react/jsx-runtime'), import('zustand'), import('./plugin-api'),
  ])
  const external: Record<string, unknown> = { react, 'react-dom': reactDom, 'react/jsx-runtime': jsx, zustand, '@grimoire/plugin-api': sdk }
  const cache = new Map<string, CommonJsModule>()
  const styles: string[] = []
  const evaluate = (name: string): Record<string, unknown> => {
    const previous = cache.get(name)
    if (previous) return previous.exports
    const source = pkg.files[name]
    if (typeof source !== 'string') throw new Error(`Missing plugin module ${name}`)
    const module: CommonJsModule = { exports: {} }
    cache.set(name, module)
    if (name.endsWith('.css')) {
      const scoped = name.endsWith('.module.css') ? cssModule(source, `${pkg.fingerprint}/${name}`) : { css: source, classes: {} }
      styles.push(scoped.css)
      module.exports = { __esModule: true, default: scoped.classes }
      return module.exports
    }
    const output = ts.transpileModule(source, { fileName: name, reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } })
    const errors = output.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? []
    if (errors.length) throw new Error(`${name}: ${errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('; ')}`)
    const require = (specifier: string) => {
      if (Object.hasOwn(external, specifier)) return external[specifier]
      return evaluate(resolveRelative(name, specifier, pkg.files))
    }
    // Phase one intentionally permits trusted local JavaScript and its global side effects.
    const execute = new Function('require', 'module', 'exports', `${output.outputText}\n//# sourceURL=grimoire-plugin/${encodeURIComponent(name)}`)
    execute(require, module, module.exports)
    return module.exports
  }
  const value = evaluate(pkg.entry).default
  if (!value || typeof value !== 'object') throw new Error('Plugin entry must default-export a plugin object')
  const candidate = value as Partial<GrimoirePlugin>
  if (typeof candidate.id !== 'string' || !candidate.id || typeof candidate.name !== 'string' || !candidate.name
    || typeof candidate.version !== 'string' || typeof candidate.activate !== 'function'
    || (candidate.deactivate !== undefined && typeof candidate.deactivate !== 'function')) throw new Error('Invalid plugin export: id, name, version and activate are required')
  const plugin = candidate as GrimoirePlugin
  return { ...plugin, activate(api) { styles.forEach(css => api.addStyle(css)); return plugin.activate(api) },
    deactivate: plugin.deactivate ? () => plugin.deactivate!() : undefined }
}

let pending: Promise<unknown> = Promise.resolve()
/** Reconcile serially, including direct callers outside the mod store's serialized scan. */
export function reconcilePlugins(io: ModFs, mods: ModEntry[]): Promise<string[]> {
  const next = pending.then(async () => {
    const errors: string[] = []
    const enabled = mods.filter(mod => mod.kind === MOD_KIND.PLUGINS && mod.enabled && !mod.errors.length)
    const unload = (id: string) => {
      const current = loaded.get(id)
      if (!current) return
      loaded.delete(id)
      try { unregisterPlugin(current.pluginId) } catch (error) { errors.push(`${id}: ${message(error)}`) }
    }
    for (const [id, current] of loaded) if (!enabled.some(mod => mod.id === id && mod.folder === current.folder)) unload(id)
    for (const mod of enabled) {
      try {
        const pkg = await readPluginPackage(io, mod.folder)
        const current = loaded.get(mod.id)
        if (current?.fingerprint === pkg.fingerprint && usePluginRegistry.getState().plugins.some(plugin => plugin.id === current.pluginId)) continue
        unload(mod.id)
        const plugin = await evaluatePluginPackage(pkg)
        if (usePluginRegistry.getState().plugins.some(item => item.id === plugin.id)) throw new Error(`Duplicate plugin id: ${plugin.id}`)
        registerPlugin(plugin)
        loaded.set(mod.id, { folder: mod.folder, fingerprint: pkg.fingerprint, pluginId: plugin.id })
      } catch (error) {
        unload(mod.id)
        errors.push(`${mod.id}: ${message(error)}`)
      }
    }
    return errors
  })
  pending = next.catch(() => undefined)
  return next
}
