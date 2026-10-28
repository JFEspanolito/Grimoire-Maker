// Builds the portable zip from an already built release executable. It never builds anything itself:
// run `pnpm build:portable` (tauri build --no-bundle, then this script) or build the exe first.
//
//   node scripts/make-portable.mjs [--exe <path>] [--out <folder>]
//
// The zip holds `Grimoire Maker.exe`, an empty `portable.flag` and `README-portable.txt`. Entries are
// sorted and carry a fixed timestamp, so the same inputs always give the same archive.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zipSync } from 'fflate'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_EXE = join(ROOT, 'src-tauri', 'target', 'release', 'grimoire-maker.exe')
export const EXE_NAME = 'Grimoire Maker.exe'
export const FLAG_NAME = 'portable.flag'
export const README_NAME = 'README-portable.txt'
const FIXED_TIME = new Date(2020, 0, 1)

export function zipName(version) {
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`"${version}" is not a valid version`)
  return `GrimoireMaker-portable-${version}-x64.zip`
}

export function readmeText(version) {
  return [
    `Grimoire Maker ${version} - portable edition`,
    '',
    'WHAT PORTABLE MODE DOES',
    '  The file "portable.flag" next to "Grimoire Maker.exe" switches the app to portable mode.',
    '  Nothing is installed and nothing is written to %APPDATA% or %LOCALAPPDATA%.',
    '',
    'WHERE YOUR DATA LIVES',
    '  Everything is kept in the "Data" folder next to the exe, created on the first run:',
    '    Data\\setting.json, Data\\state, Data\\ManagedPlugins, Data\\mods.json   (settings and state)',
    '    Data\\Plugins, Data\\Snippets, Data\\Templates, Data\\Themes, Data\\Logs   (default content folders)',
    '    Data\\WebView2                                                           (browser engine data)',
    '',
    'MOVE OR BACK UP',
    '  Close the app, then copy or move the whole folder (the exe, portable.flag and Data).',
    '  Paths saved inside the portable folder keep working after the folder is moved.',
    '  Deleting "portable.flag" returns the app to normal mode (settings in %APPDATA%).',
    '',
    'REQUIREMENTS',
    '  The Microsoft Edge WebView2 Evergreen runtime (preinstalled on Windows 11 and recent Windows 10).',
    '  If the app does not start, install it from: https://developer.microsoft.com/microsoft-edge/webview2/',
    '',
    'GOOD TO KNOW',
    '  The folder must be writable. If it is not (for example Program Files or a read-only drive),',
    '  the app shows a message box explaining the problem and closes; it does not fall back to %APPDATA%.',
    '  Use a normal folder or a USB drive.',
    '  There is no automatic update: download a newer zip and replace the exe, keeping Data and portable.flag.',
    '',
  ].join('\r\n')
}

/** Returns the zip bytes for an exe buffer; pure so it can be tested without a real build. */
export function buildPortableZip(exeBytes, version) {
  const entries = {
    [EXE_NAME]: [exeBytes, { mtime: FIXED_TIME, level: 9 }],
    [FLAG_NAME]: [new Uint8Array(0), { mtime: FIXED_TIME, level: 0 }],
    [README_NAME]: [new TextEncoder().encode(readmeText(version)), { mtime: FIXED_TIME, level: 9 }],
  }
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((name) => [name, entries[name]]))
  return zipSync(sorted)
}

export function makePortable({ exe = DEFAULT_EXE, out = join(ROOT, 'release'), version } = {}) {
  const resolved = version ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  const name = zipName(resolved)
  if (!existsSync(exe) || !statSync(exe).isFile()) {
    throw new Error(`The release executable was not found at ${exe}. Build it first with: pnpm tauri build --no-bundle`)
  }
  const bytes = buildPortableZip(readFileSync(exe), resolved)
  mkdirSync(out, { recursive: true })
  const path = join(out, name)
  writeFileSync(path, bytes)
  return { path, size: bytes.length }
}

function parseArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--exe' && args[i + 1]) options.exe = resolve(args[++i])
    else if (args[i] === '--out' && args[i + 1]) options.out = resolve(args[++i])
    else throw new Error(`Unknown or incomplete option ${args[i]}. Usage: node scripts/make-portable.mjs [--exe <path>] [--out <folder>]`)
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { path, size } = makePortable(parseArgs(process.argv.slice(2)))
    console.log(`Portable zip written: ${path} (${(size / 1024 / 1024).toFixed(2)} MiB)`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
