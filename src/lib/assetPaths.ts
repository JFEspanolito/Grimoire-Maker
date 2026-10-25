const slashes = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')

/** Resolves `.` and `..` segments so a relative asset path can be read inside the fs scope. */
export function normalizePath(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..' && out.length > 1) out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join('/')
}

/** Relative path from the folder `fromDir` to `to`, e.g. `../Assets/Chapter 1/map.png`. */
export function relativePath(fromDir: string, to: string): string {
  const from = slashes(fromDir).split('/')
  const target = slashes(to).split('/')
  let shared = 0
  while (shared < from.length && shared < target.length && from[shared] === target[shared]) shared++
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
  if (!document.startsWith(`${root}/`)) return null
  const folders = document.slice(root.length + 1).split('/').slice(0, -1)
  if (folders[0]?.toLowerCase() === 'assets' || !folders.length) return null
  if (folders[0].toLowerCase() === 'draft') folders.shift()
  return [root, 'Assets', ...folders].join('/')
}
