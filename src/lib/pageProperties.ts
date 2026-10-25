import type { Frontmatter } from '../types/document'
import { bookName } from './themeHeaderFooter'
import { EMPTY_PROJECT, type ProjectSettings } from './projectSettings'
import { coAuthorNames } from './projectContributors'
import { documentLabel } from './documentLabel'

/** A saved page is titled by its file name; only an unsaved page falls back to its frontmatter title. */
export function pageTitle(frontmatter: Frontmatter, path?: string | null): string {
  const file = path?.split(/[\\/]/).pop()
  return file ? documentLabel(file) : String(frontmatter.title ?? '')
}

export function pageColumns(frontmatter: Frontmatter, fallback: 1 | 2): 1 | 2 {
  return frontmatter.columns === 1 || frontmatter.columns === 2 ? frontmatter.columns : fallback
}

export function projectPageText(root: string | null, frontmatter: Frontmatter, project: ProjectSettings = EMPTY_PROJECT, path?: string | null) {
  return { book: project.name || bookName(root), title: pageTitle(frontmatter, path), author: project.author, coAuthor: coAuthorNames(project) }
}
