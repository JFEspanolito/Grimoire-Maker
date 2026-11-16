const slashes = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')
const isWindowsPath = (path: string) => /^[a-z]:\//i.test(path) || path.startsWith('//')

/** Windows drive/UNC paths compare case-insensitively; POSIX paths keep their case. */
export function isPathInside(path: string, root: string): boolean {
  const parent = slashes(root)
  const child = slashes(path)
  return isWindowsPath(parent)
    ? child.toLowerCase().startsWith(`${parent.toLowerCase()}/`)
    : child.startsWith(`${parent}/`)
}

export const isImageFile = (path: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(path)

/** The `src` that points a document at an image already in the project, without copying it. */
export function imageReference(documentPath: string, imagePath: string): string {
  const document = slashes(documentPath)
  return relativePath(document.slice(0, document.lastIndexOf('/')), imagePath)
}

/** Resolves `.` and `..` segments so a relative asset path can be read inside the fs scope. */
export function normalizePath(path: string): string {
  const source = path.replaceAll('\\', '/')
  const drive = /^([a-z]:)\//i.exec(source)
  let prefix = ''
  let parts = source.split('/')
  if (drive) {
    prefix = `${drive[1]}/`
    parts = source.slice(drive[0].length).split('/')
  } else if (source.startsWith('//')) {
    const segments = source.slice(2).split('/').filter(Boolean)
    const [server, share] = segments
    if (!server || !share || ['.', '..'].includes(server) || ['.', '..'].includes(share)) throw new Error('Invalid UNC path root')
    prefix = `//${server}/${share}/`
    parts = segments.slice(2)
  } else if (source.startsWith('/')) prefix = '/'
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!out.length) throw new Error('Path traversal exceeds its root')
      out.pop()
    } else out.push(part)
  }
  if (!out.length && prefix.startsWith('//')) return prefix.slice(0, -1)
  return prefix + out.join('/')
}

/** Relative path from the folder `fromDir` to `to`, e.g. `../Assets/Chapter 1/map.png`. */
export function relativePath(fromDir: string, to: string): string {
  const source = slashes(fromDir)
  const from = source.split('/')
  const target = slashes(to).split('/')
  const compare = (segment: string) => isWindowsPath(source) ? segment.toLowerCase() : segment
  let shared = 0
  while (shared < from.length && shared < target.length && compare(from[shared]) === compare(target[shared])) shared++
  return [...Array<string>(from.length - shared).fill('..'), ...target.slice(shared)].join('/')
}

/**
 * Where a document's images live: `<project>/Assets`, mirroring the document's folder
 * (`Draft/Chapter 1/Scene.md` → `Assets/Chapter 1`). Draft is the default section, so its
 * name is dropped; other sections keep theirs. Null when the document is outside the project.
 */
export function assetFolder(documentPath: string, workspaceRoot: string | null): string | null {
  if (!workspaceRoot) return null
  const root = slashes(workspaceRoot)
  const document = slashes(documentPath)
  if (!isPathInside(document, root)) return null
  const folders = document.slice(root.length + 1).split('/').slice(0, -1)
  if (folders[0]?.toLowerCase() === 'assets' || !folders.length) return null
  if (folders[0].toLowerCase() === 'draft') folders.shift()
  return [root, 'Assets', ...folders].join('/')
}
