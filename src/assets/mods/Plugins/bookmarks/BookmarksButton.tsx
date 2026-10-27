import { useEffect, useRef, useState } from 'react'
import { useOpenDocument, useWorkspaceRoot } from '@grimoire/plugin-api'
import { revealBlock } from './anchors'
import { toAbsolute, useBookmarks, type Bookmark } from './bookmarkStore'
import styles from './Bookmarks.module.css'

const displayPath = (path: string) => path.replace(/\.md$/i, '')

function BookmarkDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const root = useWorkspaceRoot()
  const open = useOpenDocument()
  const { items, error, remove } = useBookmarks()
  const [status, setStatus] = useState('')

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  const go = async (bookmark: Bookmark) => {
    if (!root) return
    setStatus('')
    try {
      await open(toAbsolute(root, bookmark.path))
      if (await revealBlock(bookmark)) onClose()
      else setStatus(`"${bookmark.excerpt}" is no longer in ${displayPath(bookmark.path)}. Its text changed or was removed.`)
    } catch (failure) {
      setStatus(`Could not open ${displayPath(bookmark.path)}: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="bookmarks-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <h2 id="bookmarks-title">Bookmarks</h2>
      <button type="button" className={styles.close} aria-label="Close Bookmarks" onClick={onClose}>×</button>
    </header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {status && <p role="alert" className={styles.error}>{status}</p>}
    {items.length === 0
      ? <p className={styles.empty}>No bookmarks yet. Right-click a paragraph on a page and choose Add to bookmark.</p>
      : <ul className={styles.list}>
        {items.map(bookmark => <li key={bookmark.id} className={styles.item}>
          <button type="button" className={styles.go} title="Go to this bookmark" onClick={() => void go(bookmark)}>
            <span className={styles.label}>{bookmark.excerpt}</span>
            <span className={styles.where}>{displayPath(bookmark.path)}</span>
          </button>
          <button type="button" className={styles.remove} aria-label={`Remove bookmark ${bookmark.excerpt}`} title="Remove bookmark"
            onClick={() => remove(bookmark.id)}>Remove</button>
        </li>)}
      </ul>}
  </dialog>
}

export function BookmarksButton() {
  const root = useWorkspaceRoot()
  const load = useBookmarks(state => state.load)
  const count = useBookmarks(state => state.items.length)
  const [shown, setShown] = useState(false)
  useEffect(() => { if (root) void load(root) }, [root, load])
  return <>
    <button type="button" className={styles.button} disabled={!root} title="Bookmarks of this project" onClick={() => setShown(true)}>
      Bookmarks <span className={styles.count}>{count}</span>
    </button>
    {shown && <BookmarkDialog onClose={() => setShown(false)} />}
  </>
}
