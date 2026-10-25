import { useEffect, useRef, useState } from 'react'
import { draftDocuments, moveItem, resolveDocumentOrder, toDocumentOrder, type OrderItem } from '../../lib/documentOrder'
import { useDocumentStore } from '../../stores/documentStore'
import { EMPTY_ENTRY, useProjectStore } from '../../stores/projectStore'
import styles from './DocumentOrderDialog.module.css'

const label = (path: string) => path.replace(/^Draft\//i, '').replace(/\.md$/i, '')

/** Chooses which Draft documents the exported PDF contains and in what order. */
export function DocumentOrderDialog({ root, onClose }: { root: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const tree = useDocumentStore((state) => state.tree)
  const entry = useProjectStore((state) => state.entries[root] ?? EMPTY_ENTRY)
  const [items, setItems] = useState<OrderItem[] | null>(null)

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  useEffect(() => {
    if (!useProjectStore.getState().entries[root]?.ready) void useProjectStore.getState().load(root)
  }, [root])
  useEffect(() => {
    if (entry.ready && items === null) setItems(resolveDocumentOrder(draftDocuments(tree, root), entry.settings.documentOrder))
  }, [entry.ready, entry.settings.documentOrder, items, root, tree])

  const included = items?.filter((item) => item.included).length ?? 0
  const save = async () => {
    if (!items) return
    const current = useProjectStore.getState().entries[root]
    if (await useProjectStore.getState().save(root, { ...current.settings, documentOrder: toDocumentOrder(items) })) onClose()
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="document-order-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <h2 id="document-order-title">Document Order</h2>
      <button type="button" className={styles.dismiss} aria-label="Close Document Order" onClick={onClose}>×</button>
    </header>
    <p className={styles.hint}>Checked Draft documents are joined, top to bottom, into one PDF. New documents are added at the end.</p>
    {items === null ? <p role="status">Loading…</p> : items.length === 0 ? <p role="status">There are no documents in Draft.</p> :
      <ol className={styles.list} aria-label="Documents">
        {items.map((item, index) => <li key={item.path}>
          <label>
            <input type="checkbox" checked={item.included} aria-label={`Include ${label(item.path)}`}
              onChange={() => setItems(items.map((other, at) => at === index ? { ...other, included: !other.included } : other))} />
            <span title={item.path}>{label(item.path)}</span>
          </label>
          <button type="button" aria-label={`Move ${label(item.path)} up`} disabled={index === 0}
            onClick={() => setItems(moveItem(items, index, -1))}>↑</button>
          <button type="button" aria-label={`Move ${label(item.path)} down`} disabled={index === items.length - 1}
            onClick={() => setItems(moveItem(items, index, 1))}>↓</button>
        </li>)}
      </ol>}
    {entry.error && <p role="alert">{entry.error}</p>}
    <footer className={styles.footer}>
      <span role="status">{items ? `${included} of ${items.length} included` : ''}</span>
      <button type="button" onClick={onClose}>Cancel</button>
      <button type="button" className={styles.primary} disabled={!items || entry.busy} onClick={() => void save()}>Save</button>
    </footer>
  </dialog>
}
