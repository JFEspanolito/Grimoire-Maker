import { useToastStore } from '../../stores/toastStore'
import styles from './ToastHost.module.css'

/** Renders the short notices from the toast store; mounted once in App. */
export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts)
  if (!toasts.length) return null
  return (
    <div className={styles.host} role="status" aria-live="polite">
      {toasts.map((toast) => <p key={toast.id} className={styles.toast}>{toast.message}</p>)}
    </div>
  )
}
