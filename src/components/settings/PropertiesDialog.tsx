import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { PropertiesPanel } from './PropertiesPanel'
import styles from './DocumentOrderDialog.module.css'

/** Every project and page property in one place, opened from the Document menu. */
export function PropertiesDialog({ onClose, editor = null }: { onClose: () => void; editor?: Editor | null }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="properties-dialog-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <h2 id="properties-dialog-title">Properties</h2>
      <button type="button" className={styles.dismiss} aria-label="Close Properties" onClick={onClose}>×</button>
    </header>
    <PropertiesPanel expanded editor={editor} />
    <footer className={styles.footer}><button type="button" onClick={onClose}>Close</button></footer>
  </dialog>
}
