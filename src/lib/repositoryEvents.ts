export const REPOSITORY_CHANGED = 'grimoire:repository-changed'

export function notifyRepositoryChanged(): void {
  window.dispatchEvent(new Event(REPOSITORY_CHANGED))
}
