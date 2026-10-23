import { open, save } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readFile, remove, rename, stat, writeFile } from '@tauri-apps/plugin-fs'
import { collectPackage, createTemplateDocuments, installPackage, type ProjectPackageFs } from './templateIo'
import { LIMITS, PackageError, createTemplateZip } from './templatePackage'
import { OFFICIAL_TEMPLATES, type Template } from './templates'
import { ensureConfigSubdir } from './themes'
import { serializeDocument } from './frontmatter'

const tauriFs: ProjectPackageFs = {
  readFile,
  writeFile: (path, data) => writeFile(path, data),
  mkdir: (path) => mkdir(path, { recursive: true }),
  exists,
  readDir: async (path) =>
    (await readDir(path)).map((e) => ({ name: e.name, isDirectory: e.isDirectory, isSymlink: e.isSymlink })),
  rename,
  removeDir: (path) => remove(path, { recursive: true }),
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
  const files =
    location?.kind === 'package'
      ? await collectPackage(tauriFs, location.path)
      : { 'index.md': location?.kind === 'file'
        ? await readFile(location.path)
        : new TextEncoder().encode(serializeDocument(template.frontmatter, template.body)) }
  const target = await save({ defaultPath: `${template.id}.zip`, filters: ZIP_FILTER })
  if (!target) return false
  await writeFile(target, createTemplateZip(files))
  return true
}

/** Writes the template's starting document, chapters and assets into the active project's Draft. */
export async function applyTemplateFiles(template: Template, workspaceRoot: string): Promise<string> {
  return createTemplateDocuments(tauriFs, `${workspaceRoot}/Draft`, template)
}
