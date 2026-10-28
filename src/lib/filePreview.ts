export const FILE_KIND = {
  markdown: 'markdown', image: 'image', pdf: 'pdf', word: 'word', text: 'text', unsupported: 'unsupported',
} as const
export type FileKind = (typeof FILE_KIND)[keyof typeof FILE_KIND]

export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon',
}

export function fileExtension(path: string): string {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? ''
  return name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : ''
}

export function classifyFile(path: string): FileKind {
  const extension = fileExtension(path)
  if (extension === 'md') return FILE_KIND.markdown
  if (Object.hasOwn(IMAGE_MIME, extension)) return FILE_KIND.image
  if (extension === 'pdf') return FILE_KIND.pdf
  if (extension === 'docx' || extension === 'doc') return FILE_KIND.word
  if (extension === 'txt') return FILE_KIND.text
  return FILE_KIND.unsupported
}
