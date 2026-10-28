import { useEffect, useRef } from 'react'
import styles from './ConfirmDialog.module.css'

interface Props {
  title: string
  message: string
  cancelLabel?: string
  secondaryLabel?: string
  confirmLabel: string
  /** Styles the confirm button as destructive. */
  danger?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onSecondary?: () => void
  onCancel: () => void
}

/** App-styled confirmation; Cancel has focus first so Enter never confirms by accident. */
export function ConfirmDialog({
  title,
  message,
  cancelLabel = 'Cancel',
  secondaryLabel,
  confirmLabel,
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onSecondary,
  onCancel,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    cancel.current?.focus()
    return () => {
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  const className = secondaryLabel && onSecondary ? `${styles.dialog} ${styles.wide}` : styles.dialog
  return <dialog ref={dialog} className={className} aria-labelledby="confirm-title" aria-describedby="confirm-message"
    onCancel={(event) => { event.preventDefault(); onCancel() }}>
    <h2 id="confirm-title">{title}</h2>
    <p id="confirm-message">{message}</p>
    <footer>
      <button ref={cancel} type="button" onClick={onCancel}>{cancelLabel}</button>
      {secondaryLabel && onSecondary && (
        <button type="button" onClick={onSecondary}>{secondaryLabel}</button>
      )}
      <button type="button" disabled={confirmDisabled} className={danger ? styles.danger : styles.primary} onClick={onConfirm}>
        {confirmLabel}
      </button>
    </footer>
  </dialog>
}
