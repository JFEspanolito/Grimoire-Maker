import { getActivePath, type GrimoirePlugin, type PluginSurface } from '@grimoire/plugin-api'
import { describeBlock } from './anchors'
import { useBookmarks } from './bookmarkStore'
import { BookmarksButton } from './BookmarksButton'

/** Right-click on a page's text offers Add to bookmark; everything else keeps the native menu. */
export function mountBookmarkMenu(element: HTMLElement, surface: PluginSurface): () => void {
  if (surface.kind !== 'editor') return () => {}
  const contextMenu = (event: MouseEvent) => {
    const path = getActivePath()
    const anchor = describeBlock(event.target)
    if (!path || !/\.md$/i.test(path) || !anchor) return
    event.preventDefault()
    useBookmarks.getState().openMenu({ x: event.clientX, y: event.clientY, path, anchor })
  }
  element.addEventListener('contextmenu', contextMenu)
  return () => {
    element.removeEventListener('contextmenu', contextMenu)
    useBookmarks.getState().closeMenu()
  }
}

const bookmarks: GrimoirePlugin = {
  id: 'builtin.bookmarks', name: 'Bookmarks', version: '1.0.0',
  activate(api) {
    api.registerToolbar({ id: 'bookmarks.control', title: 'Bookmarks', component: BookmarksButton })
    api.registerPageBehavior({ id: 'bookmarks.context-menu', mount: mountBookmarkMenu })
  },
}
export default bookmarks
