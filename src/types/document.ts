export type PageSizeId = 'a4' | 'letter' | 'b5'

export interface PageSize {
  id: PageSizeId
  label: string
  /** Width in millimetres. */
  widthMm: number
  /** Height in millimetres. */
  heightMm: number
}

export const PAGE_SIZES: Record<PageSizeId, PageSize> = {
  a4: { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  letter: { id: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4 },
  b5: { id: 'b5', label: 'B5 / Digest', widthMm: 176, heightMm: 250 },
}

/** `edit` is the editable sheet; `pages` and `spreads` are the paginated, read-only layouts. */
export type ViewMode = 'edit' | 'pages' | 'spreads'

/** Theme file name without `.css`; built-ins plus any mod in the user themes folder. */
export type ThemeId = string

export interface Frontmatter {
  title?: string
  author?: string
  system?: string
  pageSize?: PageSizeId
  columns?: 1 | 2
  theme?: ThemeId
  [key: string]: unknown
}

export interface GrimoireDocument {
  /** Absolute path on disk, or null for an unsaved document. */
  path: string | null
  frontmatter: Frontmatter
  /** Markdown body, without the frontmatter block. */
  body: string
  dirty: boolean
}

export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
}
