// Packs a plugin folder (manifest.json + dist/**) into a .gmp archive the application can import.
// The application validates everything again on import; this tool only catches mistakes early and
// produces a deterministic archive.
//
//   node scripts/pack-plugin.mjs <plugin-folder> [--out <folder>]
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zipSync } from 'fflate'

export const LIMITS = { entries: 256, depth: 8, file: 8 * 1024 * 1024, total: 32 * 1024 * 1024, archive: 20 * 1024 * 1024 }
const MAIN = 'dist/index.js'
const FIXED_TIME = new Date(2020, 0, 1)

function walk(root, relative, found) {
  for (const name of readdirSync(join(root, relative)).sort()) {
    const path = relative ? `${relative}/${name}` : name
    const info = lstatSync(join(root, path))
    if (info.isSymbolicLink()) throw new Error(`${path} is a link; links are not allowed in a package`)
    if (path.split('/').length > LIMITS.depth) throw new Error(`${path} is deeper than ${LIMITS.depth} levels`)
    if (/[\\:<>"|?*\u0000-\u001f]/.test(path) || /[. ]$/.test(name)) throw new Error(`${path} has a name Windows cannot store`)
    if (info.isDirectory()) walk(root, path, found)
    else if (info.isFile()) {
      if (info.size > LIMITS.file) throw new Error(`${path} is larger than ${LIMITS.file / 1024 / 1024} MiB`)
      found.push(path)
    } else throw new Error(`${path} is not a regular file`)
  }
}

/** Returns { name, bytes } for the folder, or throws a readable error. */
export function packPlugin(folder) {
  const root = resolve(folder)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  } catch (error) {
    throw new Error(`manifest.json is missing or is not valid JSON (${error.message})`)
  }
  for (const field of ['schemaVersion', 'sdkVersion', 'id', 'name', 'version', 'author', 'description', 'main']) {
    if (manifest[field] === undefined) throw new Error(`manifest.json has no "${field}"`)
  }
  if (manifest.main !== MAIN) throw new Error(`"main" must be exactly ${MAIN}`)
  if (/^builtin(\.|$)/.test(manifest.id)) throw new Error('The builtin.* ids are reserved for plugins shipped with the application')
  const files = []
  try {
    walk(root, 'dist', files)
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('There is no dist/ folder; build your plugin into dist/index.js first')
    throw error
  }
  if (!files.includes(MAIN)) throw new Error(`${MAIN} is missing`)
  const names = ['manifest.json', ...files]
  if (names.length > LIMITS.entries) throw new Error(`A package may hold at most ${LIMITS.entries} files`)
  const seen = new Set()
  for (const name of names) {
    const key = name.toLowerCase()
    if (seen.has(key)) throw new Error(`${name} collides with another file when case is ignored`)
    seen.add(key)
  }
  const entries = Object.fromEntries(names.map((name) => [name, [readFileSync(join(root, name)), { mtime: FIXED_TIME, level: 9 }]]))
  const total = Object.values(entries).reduce((sum, [bytes]) => sum + bytes.length, 0)
  if (total > LIMITS.total) throw new Error(`The package is larger than ${LIMITS.total / 1024 / 1024} MiB unpacked`)
  const bytes = zipSync(entries)
  if (bytes.length > LIMITS.archive) throw new Error(`The archive is larger than ${LIMITS.archive / 1024 / 1024} MiB`)
  return { name: `${manifest.id}-${manifest.version}.gmp`, bytes }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const out = outIndex >= 0 ? args.splice(outIndex, 2)[1] : '.'
  if (args.length !== 1 || !out) {
    console.error('Usage: node scripts/pack-plugin.mjs <plugin-folder> [--out <folder>]')
    process.exit(2)
  }
  try {
    const { name, bytes } = packPlugin(args[0])
    mkdirSync(out, { recursive: true })
    const target = join(out, basename(name))
    writeFileSync(target, bytes)
    console.log(`Wrote ${target} (${bytes.length} bytes). Import it from Mod Manager > Import Mod > Plugins.`)
  } catch (error) {
    console.error(`Could not pack the plugin: ${error.message}`)
    process.exit(1)
  }
}
