import { useEffect, useId, useRef, useState } from 'react'
import styles from './ModManager.module.css'

interface Props {
  /** Name shown to the user, also used in the accessible names. */
  name: string
  disabled?: boolean
  /** Runs only after the user confirmed. Its failures are shown by the caller. */
  onConfirm(): void | Promise<unknown>
}

/** A small Delete button that never deletes without a confirmation dialog (Cancel is focused first). */
export function DeleteModButton({ name, disabled, onConfirm }: Props) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const textId = useId()

  useEffect(() => { if (open) cancel.current?.focus() }, [open])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  const confirm = () => {
    setOpen(false)
    void onConfirm()
  }

  return (
    <>
      <button ref={trigger} type="button" className={styles.danger} disabled={disabled} aria-label={`Delete ${name}`} onClick={() => setOpen(true)}>Delete</button>
      {open && (
        <div className={styles.modalBackdrop} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
          <div className={styles.modalCard} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId}>
            <header className={styles.modalHeader}>
              <h3 id={titleId}>Delete {name}?</h3>
            </header>
            <p id={textId}>
              {name} will be deleted permanently. It cannot be recovered. To use it again you will have to install it again.
            </p>
            <footer className={styles.modalActions}>
              <button ref={cancel} type="button" onClick={close}>Cancel</button>
              <button type="button" className={styles.danger} onClick={confirm}>Delete</button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
