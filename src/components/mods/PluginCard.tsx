import { useId, useState, type ReactNode } from 'react'
import styles from './PluginCard.module.css'

export type PluginOrigin = 'Built in' | 'Imported' | 'Local'

interface Props {
  name: string
  version?: string
  origin: PluginOrigin
  /** One short plain word or phrase: On, Off, Needs approval, Stopped, Changed. */
  status: string
  /** One plain line. */
  description: string
  /** Primary action button(s), shown on the right of the first row. */
  actions?: ReactNode
  /** Everything else; only rendered while the Details panel is open. */
  details: ReactNode
  /** Extra content rendered outside the three rows (for example the approval dialog). */
  children?: ReactNode
}

/** One plugin as at most three rows: name, status and actions; a one-line description; a Details toggle. */
export function PluginCard({ name, version, origin, status, description, actions, details, children }: Props) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className={styles.card} data-plugin-card={name}>
      <div className={styles.head} data-row="1">
        <span className={styles.title}>
          <strong>{name}</strong>
          {version && <small>v{version}</small>}
          <span className={styles.chip}>{origin}</span>
          <span className={styles.status}>{status}</span>
        </span>
        {actions && <span className={styles.actions}>{actions}</span>}
      </div>
      <p className={styles.description} data-row="2">{description}</p>
      <button type="button" className={styles.toggle} data-row="3" aria-expanded={open} aria-controls={panelId}
        aria-label={`Details of ${name}`} onClick={() => setOpen((value) => !value)}>Details</button>
      {open && <div id={panelId} className={styles.panel} role="group" aria-label={`${name} details`}>{details}</div>}
      {children}
    </div>
  )
}

/** One label and value line inside a Details panel. */
export function DetailLine({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.line}><span>{label}</span> {children}</div>
}
