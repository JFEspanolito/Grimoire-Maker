import { useMemo } from 'react'
import { reportError } from '../../lib/errorLogging'
import { useModStore } from '../../stores/modStore'
import { useToastStore } from '../../stores/toastStore'

export const SNIPPET_ADDED_MESSAGE = 'Snippet añadido a la paleta lateral'
export const DEFAULT_SNIPPET_CATEGORY = 'General'

export interface SnippetDraft {
  name: string
  category: string
  markdown: string
}

/** Plain validation message for a snippet draft, or '' when it can be saved. */
export function snippetDraftProblem(draft: SnippetDraft): string {
  if (!draft.name.trim()) return 'Enter a snippet name.'
  if (!draft.markdown.trim()) return 'Add some Markdown content for the snippet.'
  return ''
}

/**
 * Writes the snippet into the local Snippets library, reloads the mod catalog so the side
 * palette picks it up, and shows the confirmation toast. Returns the saved path.
 */
export async function saveSnippetAndRefresh(draft: SnippetDraft): Promise<string> {
  // Loaded on demand so editor-only screens do not pull in the file-system layer.
  const { saveSnippetToLibrary } = await import('../../lib/snippetLibrary')
  const { path } = await saveSnippetToLibrary({
    name: draft.name.trim(),
    category: draft.category.trim() || DEFAULT_SNIPPET_CATEGORY,
    markdown: draft.markdown,
  })
  // The snippet is already on disk; a failed refresh must not report the save as failed.
  await useModStore.getState().reload().catch((error) => reportError('snippets.reload', error))
  useToastStore.getState().show(SNIPPET_ADDED_MESSAGE)
  return path
}

/** Existing snippet groups, offered as category suggestions. */
export function useSnippetCategories(): string[] {
  const snippets = useModStore((state) => state.snippets)
  return useMemo(() => [...new Set(snippets.map((snippet) => snippet.group))].sort((a, b) => a.localeCompare(b)), [snippets])
}
