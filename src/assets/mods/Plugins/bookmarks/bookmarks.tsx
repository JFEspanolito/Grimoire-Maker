import type { GrimoirePlugin, PluginContextActionContext } from '@grimoire/plugin-api'
import { describeBlock } from './anchors'
import { useBookmarks } from './bookmarkStore'
import { BookmarksButton } from './BookmarksButton'

const isPage = (path: string | null): path is string => !!path && /\.md$/i.test(path)

/** The editor's right-click menu lists this item for text blocks of a Markdown page; everything else keeps its own items. */
export const addToBookmark = {
  id: 'bookmarks.add',
  label: 'Add to bookmark',
  when: ({ target, path }: PluginContextActionContext) => isPage(path) && describeBlock(target) !== null,
  run({ target, path }: PluginContextActionContext) {
    const anchor = describeBlock(target)
    if (isPage(path) && anchor) useBookmarks.getState().add(path, anchor)
  },
}

const bookmarks: GrimoirePlugin = {
  id: 'builtin.bookmarks', name: 'Bookmarks', version: '1.1.0',
  activate(api) {
    api.registerToolbar({ id: 'bookmarks.control', title: 'Bookmarks', component: BookmarksButton })
    api.registerContextAction(addToBookmark)
  },
}
export default bookmarks
