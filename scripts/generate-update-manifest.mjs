// Generates or updates the official Tauri v2 static update manifest (latest.json).
// Scans the bundle output directory for signed updater bundles (*.sig) and builds the platforms map.
//
// Usage:
//   node scripts/generate-update-manifest.mjs [--tag <tag>] [--version <version>] [--bundle-dir <path>] [--out <path>] [--notes <notes>] [--existing <path>]
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BUNDLE_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle')
const DEFAULT_OUT = join(ROOT, 'release', 'latest.json')
const REPO = 'JFEspanolito/Grimoire-Maker'

export function findSignedBundles(bundleDir) {
  const results = []
  if (!existsSync(bundleDir)) return results

  function walk(current) {
    const entries = readdirSync(current)
    for (const entry of entries) {
      const full = join(current, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (stat.isFile() && entry.endsWith('.sig')) {
        const bundleFile = full.slice(0, -4)
        if (existsSync(bundleFile)) {
          results.push({
            sigPath: full,
            bundlePath: bundleFile,
            sigFileName: entry,
            bundleFileName: basename(bundleFile),
          })
        }
      }
    }
  }

  walk(bundleDir)
  return results
}

export function detectPlatforms(filename) {
  const name = filename.toLowerCase()
  if (name.endsWith('.nsis.zip') || name.includes('setup.nsis.zip')) {
    return ['windows-x86_64']
  }
  if (name.endsWith('.app.tar.gz') || name.includes('.app.tar.gz')) {
    if (name.includes('aarch64') || name.includes('arm64')) {
      return ['darwin-aarch64']
    }
    if (name.includes('x86_64') || name.includes('x64')) {
      return ['darwin-x86_64']
    }
    return ['darwin-aarch64', 'darwin-x86_64']
  }
  if (name.endsWith('.appimage.tar.gz') || name.endsWith('.deb') || name.endsWith('.rpm')) {
    if (name.includes('aarch64') || name.includes('arm64')) return ['linux-aarch64']
    return ['linux-x86_64']
  }
  return []
}

export function createManifest({
  version,
  tag,
  notes = '',
  bundles = [],
  existingManifest = null,
  pubDate = new Date().toISOString(),
}) {
  const manifest = existingManifest ? JSON.parse(JSON.stringify(existingManifest)) : {
    version: tag.replace(/^v/, ''),
    notes: notes || `Grimoire Maker ${tag}`,
    pub_date: pubDate,
    platforms: {},
  }

  manifest.version = tag.replace(/^v/, '')
  if (notes) manifest.notes = notes
  if (!manifest.pub_date) manifest.pub_date = pubDate
  if (!manifest.platforms) manifest.platforms = {}

  for (const bundle of bundles) {
    const signature = readFileSync(bundle.sigPath, 'utf8').trim()
    const platforms = detectPlatforms(bundle.bundleFileName)
    const downloadUrl = `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(bundle.bundleFileName)}`

    for (const platform of platforms) {
      manifest.platforms[platform] = {
        signature,
        url: downloadUrl,
      }
    }
  }

  return manifest
}

export function generateManifest(options = {}) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const version = options.version || pkg.version
  const tag = options.tag || `v${version}`
  const bundleDir = options.bundleDir ? resolve(options.bundleDir) : DEFAULT_BUNDLE_DIR
  const outPath = options.out ? resolve(options.out) : DEFAULT_OUT

  let existingManifest = null
  if (options.existing && existsSync(options.existing)) {
    try {
      existingManifest = JSON.parse(readFileSync(options.existing, 'utf8'))
    } catch (e) {
      console.warn(`Could not parse existing manifest at ${options.existing}:`, e.message)
    }
  } else if (existsSync(outPath)) {
    try {
      existingManifest = JSON.parse(readFileSync(outPath, 'utf8'))
    } catch {
      // ignore
    }
  }

  const bundles = findSignedBundles(bundleDir)
  const manifest = createManifest({
    version,
    tag,
    notes: options.notes,
    bundles,
    existingManifest,
  })

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { path: outPath, manifest, bundleCount: bundles.length }
}

function parseArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--tag' && args[i + 1]) options.tag = args[++i]
    else if (args[i] === '--version' && args[i + 1]) options.version = args[++i]
    else if (args[i] === '--bundle-dir' && args[i + 1]) options.bundleDir = args[++i]
    else if (args[i] === '--out' && args[i + 1]) options.out = args[++i]
    else if (args[i] === '--notes' && args[i + 1]) options.notes = args[++i]
    else if (args[i] === '--existing' && args[i + 1]) options.existing = args[++i]
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = generateManifest(parseArgs(process.argv.slice(2)))
    console.log(`Generated update manifest at ${result.path} with ${result.bundleCount} signed bundle(s).`)
    console.log(`Platforms configured: ${Object.keys(result.manifest.platforms).join(', ') || 'none'}`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
