import { open } from '@tauri-apps/plugin-dialog'
import { copyFile, exists, mkdir, readFile } from '@tauri-apps/plugin-fs'
import { assetFolder, imageReference, normalizePath, relativePath } from './assetPaths'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))
const isInline = (src: string): boolean => /^(https?:|data:|blob:)/i.test(src)
const isAbsolute = (src: string): boolean => /^[a-zA-Z]:[\\/]|^\//.test(src)

/**
 * Turns an image `src` from the document into something an `<img>` can load.
 * Files are read through the fs plugin (so only folders the app may read are
 * reachable) and exposed as blob URLs; relative paths resolve against the
 * document's folder. The caller owns the returned blob URL and must revoke it.
 */
export async function loadImageUrl(src: string, documentPath: string | null): Promise<string> {
  if (isInline(src)) return src
  const path = isAbsolute(src)
    ? src.replaceAll('\\', '/')
    : documentPath
      ? normalizePath(`${dirOf(documentPath)}/${src}`)
      : null
  if (!path) throw new Error('Save the document to show images with relative paths')
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const bytes = await readFile(path)
  return URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? 'application/octet-stream' }))
}

export const revokeImageUrl = (url: string): void => {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/**
 * Lets the user pick an image and copies it into the project's `Assets` folder (mirroring
 * the document's folder), so Draft keeps only documents. Documents outside a project keep
 * an `assets/` folder next to them. Returns the path, relative to the document, to store
 * in the Markdown, or null if the dialog was cancelled.
 */
export async function importImage(documentPath: string, workspaceRoot: string | null = null): Promise<string | null> {
  const projectRoot = workspaceRoot?.replaceAll('\\', '/').replace(/\/+$/, '') ?? null
  // Start where the project's images already are, so reusing one is the easy path.
  const picked = await open({
    defaultPath: projectRoot && (await exists(`${projectRoot}/Assets`)) ? `${projectRoot}/Assets` : undefined,
    filters: [{ name: 'Images', extensions: Object.keys(MIME) }],
  })
  if (typeof picked !== 'string') return null

  const source = picked.replaceAll('\\', '/')
  // An image that already lives in the project is referenced in place: no second copy.
  if (projectRoot && source.startsWith(`${projectRoot}/`)) return imageReference(documentPath, source)
  const assets = assetFolder(documentPath, workspaceRoot) ?? `${dirOf(documentPath)}/assets`
  if (!(await exists(assets))) await mkdir(assets, { recursive: true })

  const original = source.slice(source.lastIndexOf('/') + 1)
  const dot = original.lastIndexOf('.')
  const stem = original.slice(0, dot).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'image'
  const ext = original.slice(dot).toLowerCase()

  let name = `${stem}${ext}`
  for (let n = 1; await exists(`${assets}/${name}`); n++) name = `${stem}-${n}${ext}`
  await copyFile(source, `${assets}/${name}`)
  return relativePath(dirOf(documentPath), `${assets}/${name}`)
}
