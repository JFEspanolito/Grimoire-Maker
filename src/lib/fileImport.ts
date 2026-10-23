export type ImportSection = 'Draft' | 'Research'

interface ImportIO {
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<{ size: number; isFile: boolean }>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array, options: { createNew: boolean }): Promise<void>
}

/** Copy selected files, leaving sources and existing destinations untouched. */
export async function importFiles(root: string, section: ImportSection, sources: string[], io: ImportIO): Promise<string[]> {
  const imported: string[] = []
  for (const source of sources) {
    const name = source.replaceAll('\\', '/').split('/').pop() ?? ''
    if (!name || name === '.' || name === '..') throw new Error('Invalid import filename')
    const info = await io.stat(source)
    if (!info.isFile) throw new Error(`${name} is not a regular file`)
    if (info.size > 64 * 1024 * 1024) throw new Error(`${name} exceeds the 64 MiB import limit`)
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    let destination = `${root}/${section}/${name}`
    let suffix = 1
    while (await io.exists(destination)) {
      if (suffix > 10000) throw new Error(`Too many copies of ${name}`)
      destination = `${root}/${section}/${stem}-${suffix++}${extension}`
    }
    const bytes = await io.readFile(source)
    if (bytes.byteLength > 64 * 1024 * 1024) throw new Error(`${name} exceeds the 64 MiB import limit`)
    // Exclusive creation also protects against collisions after the existence check.
    await io.writeFile(destination, bytes, { createNew: true })
    imported.push(destination)
  }
  return imported
}
