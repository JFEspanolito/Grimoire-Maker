import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import styles from './ModManager.module.css'

interface Props {
  /** Name shown to the user, also used in the accessible names. */
  name: string
  disabled?: boolean
  /** Runs only after the user confirmed. Its failures are shown by the caller. */
  onConfirm(): void | Promise<unknown>
}

/** How long the dialog's buttons ignore clicks after it opens. */
const ARM_DELAY_MS = 300

/** A small Delete button that never deletes without a confirmation dialog (Cancel is focused first). */
export function DeleteModButton({ name, disabled, onConfirm }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const textId = useId()

  // A double-click on the trigger can land its second click on a dialog button; they ignore clicks for a moment.
  const armed = useRef(false)

  useEffect(() => {
    if (!open) return undefined
    armed.current = false
    cancel.current?.focus()
    const timer = setTimeout(() => { armed.current = true }, ARM_DELAY_MS)
    return () => clearTimeout(timer)
  }, [open])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  const cancelClick = () => { if (armed.current) close() }
  const confirm = () => {
    if (!armed.current) return
    setOpen(false)
    void onConfirm()
  }

  return (
    <>
      <button ref={trigger} type="button" className={styles.danger} disabled={disabled} aria-label={`${t('common.delete')} ${name}`} onClick={() => setOpen(true)}>{t('common.delete')}</button>
      {open && (
        <div className={styles.modalBackdrop} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
          <div className={styles.modalCard} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId}>
            <header className={styles.modalHeader}>
              <h3 id={titleId}>{t('mods.deleteTitle')} {name}?</h3>
            </header>
            <p id={textId}>
              {name} {t('mods.deleteDesc')}
            </p>
            <footer className={styles.modalActions}>
              <button ref={cancel} type="button" onClick={cancelClick}>{t('common.cancel')}</button>
              <button type="button" className={styles.danger} onClick={confirm}>{t('common.delete')}</button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
