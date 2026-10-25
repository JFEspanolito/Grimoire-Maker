import { useEffect, useRef } from 'react'
import configSource from '../../../src-tauri/tauri.conf.json?raw'
import styles from './AppInfoDialog.module.css'

const INFO_DIALOG = { ABOUT: 'about', TUTORIAL: 'tutorial' } as const
export type InfoDialogKind = (typeof INFO_DIALOG)[keyof typeof INFO_DIALOG]
interface Props { kind: InfoDialogKind; onClose: () => void }
const { productName, version } = JSON.parse(configSource) as { productName: string; version: string }
const PROJECT_URL = 'https://github.com/JFEspanolito/Grimoire-Maker'
const CONTRIBUTORS_URL = `${PROJECT_URL}/Contributors`

export function AppInfoDialog({ kind, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = kind === INFO_DIALOG.ABOUT ? 'About' : 'Tutorial'
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="app-info-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <h2 id="app-info-title">{title}</h2>
      <button type="button" className={styles.dismiss} aria-label={`Close ${title}`} onClick={onClose}>×</button>
    </header>
    {kind === INFO_DIALOG.ABOUT ? <div className={styles.content}>
      <section aria-label="Application information">
        <h3 className={styles.appName}>{productName}</h3>
        <p className={styles.muted}>Version {version}</p>
      </section>
      <section aria-labelledby="app-contact-title">
        <h3 id="app-contact-title">Contact</h3>
        <a href="mailto:apps@jfespanolito.dev">apps@jfespanolito.dev</a>
        <a className={styles.github} href={PROJECT_URL} target="_blank" rel="noopener noreferrer" aria-label={`${productName} on GitHub`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 .1 1.68 1.92 3.3 1.18.1-.73.39-1.23.71-1.51-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.64 0c2.15-1.46 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.27-5.15 5.55.41.35.77 1.04.77 2.09v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
          </svg>
          <span>GitHub project</span>
        </a>
      </section>
      <section aria-labelledby="app-credits-title">
        <h3 id="app-credits-title">Credits</h3>
        <button type="button" data-credits disabled title={CONTRIBUTORS_URL} aria-describedby="app-credits-note">Contributors (coming soon)</button>
        <p id="app-credits-note" className={styles.muted}>Contributor credits will be available when the repository is public.</p>
      </section>
    </div> : <p className={styles.tutorial}>In development</p>}
    <footer className={styles.footer}><button type="button" onClick={onClose}>Close</button></footer>
  </dialog>
}
