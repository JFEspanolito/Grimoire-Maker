import type { Frontmatter } from '../types/document'
import { bookName } from './themeHeaderFooter'
import { EMPTY_PROJECT, type ProjectSettings } from './projectSettings'
import { coAuthorNames } from './projectContributors'

export function pageColumns(frontmatter: Frontmatter, fallback: 1 | 2): 1 | 2 {
  return frontmatter.columns === 1 || frontmatter.columns === 2 ? frontmatter.columns : fallback
}

export function projectPageText(root: string | null, frontmatter: Frontmatter, project: ProjectSettings = EMPTY_PROJECT) {
  return { book: project.name || bookName(root), title: String(frontmatter.title ?? ''), author: project.author, coAuthor: coAuthorNames(project) }
}
