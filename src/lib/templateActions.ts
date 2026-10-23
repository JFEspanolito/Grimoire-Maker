import { open, save } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readFile, stat, writeFile } from '@tauri-apps/plugin-fs'
import { collectPackage, installPackage, type PackageFs } from './templateIo'
import { LIMITS, PackageError, createTemplateZip } from './templatePackage'
import { OFFICIAL_TEMPLATES, type Template } from './templates'
import { ensureConfigSubdir } from './themes'

const tauriFs: PackageFs = {
  readFile,
  writeFile: (path, data) => writeFile(path, data),
  mkdir: (path) => mkdir(path, { recursive: true }),
  exists,
  readDir: async (path) =>
    (await readDir(path)).map((e) => ({ name: e.name, isDirectory: e.isDirectory, isSymlink: e.isSymlink })),
}

const ZIP_FILTER = [{ name: 'Template package', extensions: ['zip'] }]

/** Asks for a `.zip`, validates it and installs it as a community template. Returns its id, or null if cancelled. */
export async function importTemplateZip(): Promise<string | null> {
  const picked = await open({ filters: ZIP_FILTER })
  if (typeof picked !== 'string') return null
  const path = picked.replaceAll('\\', '/')

  // Inflating is capped separately; this keeps a huge file from being read into memory at all.
  if ((await stat(path)).size > LIMITS.totalBytes) throw new PackageError('The archive is too large')

  const dir = await ensureConfigSubdir('templates')
  return installPackage(
    tauriFs,
    dir,
    path.slice(path.lastIndexOf('/') + 1),
    await readFile(path),
    OFFICIAL_TEMPLATES.map((t) => t.id),
  )
}

/** Saves a community template as a `.zip` the user can share. Returns false if cancelled. */
export async function exportTemplateZip(template: Template): Promise<boolean> {
  const { location } = template
  if (!location) throw new PackageError('Only community templates can be exported')

  const files =
    location.kind === 'package'
      ? await collectPackage(tauriFs, location.path)
      : { 'index.md': await readFile(location.path) }
  const target = await save({ defaultPath: `${template.id}.zip`, filters: ZIP_FILTER })
  if (!target) return false
  await writeFile(target, createTemplateZip(files))
  return true
}
