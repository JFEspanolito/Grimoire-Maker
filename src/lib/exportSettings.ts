import { projectName } from './binder'
import { draftDocuments, includedDocuments, resolveDocumentOrder } from './documentOrder'
import type { PageRequest } from './exportPdf'
import { pageColumns, pageTitle, projectPageText } from './pageProperties'
import { resolveTheme } from './themes'
import { useDocumentStore } from '../stores/documentStore'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'

/** The documents a book export joins, relative to the project root, in reading order. */
export interface BookPlan { root: string; documents: string[] }

/** Null when there is no project with a Draft; the export is then the open document alone. */
export function planBook(): BookPlan | null {
  const { workspaceRoot, tree } = useDocumentStore.getState()
  if (!workspaceRoot) return null
  const available = draftDocuments(tree, workspaceRoot)
  if (!available.length) return null
  const saved = useProjectStore.getState().entries[workspaceRoot]?.settings.documentOrder
  return { root: workspaceRoot, documents: includedDocuments(resolveDocumentOrder(available, saved)) }
}

/** Page setup for an export or its preview. A book uses the default columns; a page may override them. */
export function pageRequest(book?: BookPlan): PageRequest {
  const { pageSize, columns, theme, bleedMm, marginMm } = useSettingsStore.getState()
  const { document, workspaceRoot } = useDocumentStore.getState()
  const themes = useThemeStore.getState().themes
  const activeTheme = resolveTheme(theme, themes)
  const project = workspaceRoot ? useProjectStore.getState().entries[workspaceRoot]?.settings : undefined
  const first = book?.documents[0]
  const pageText = projectPageText(workspaceRoot, document.frontmatter, project, document.path)
  return {
    pageSize, theme: activeTheme, bleedMm, marginMm,
    columns: book ? columns : pageColumns(document.frontmatter, columns),
    headerFooter: themes.find((item) => item.id === activeTheme)?.headerFooter,
    pageText: first ? { ...pageText, title: pageTitle({}, first) } : pageText,
  }
}

/** Suggested PDF name: the book for a project export, the page title otherwise. */
export function defaultPdfName(book?: BookPlan): string {
  const { document } = useDocumentStore.getState()
  if (book) return useProjectStore.getState().entries[book.root]?.settings.name || projectName(book.root)
  return pageTitle(document.frontmatter, document.path) || 'grimoire'
}
