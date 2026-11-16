import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import configSource from '../../../src-tauri/tauri.conf.json?raw'
import packageSource from '../../../package.json?raw'
import styles from './AppInfoDialog.module.css'
import { TUTORIAL_STEPS, type TourStep } from './tutorialSteps'
export { TUTORIAL_STEPS } from './tutorialSteps'
import { localContributors, urlGithubBugReport, urlGithubFeatureRequest, urlGithubRepo, urlPrivacyPolicy } from '../../data/contributors'
import { AboutUpdates } from './AboutUpdates'
import { useTranslation } from '../../lib/i18n'
import { PANEL_IDS, useSettingsStore, type PanelVisibility } from '../../stores/settingsStore'

const INFO_DIALOG = { ABOUT: 'about', TUTORIAL: 'tutorial' } as const
export type InfoDialogKind = (typeof INFO_DIALOG)[keyof typeof INFO_DIALOG]
interface Props { kind: InfoDialogKind; onClose: () => void }
const { productName } = JSON.parse(configSource) as { productName: string }
/** package.json is the one place the app version is set; Tauri and the crate follow it. */
const { version } = JSON.parse(packageSource) as { version: string }
const PROJECT_URL = urlGithubRepo

async function fetchContributors(signal: AbortSignal): Promise<typeof localContributors> {
  const contributors: typeof localContributors = []
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`https://api.github.com/repos/JFEspanolito/Grimoire-Maker/contributors?per_page=100&page=${page}`, {
      signal, credentials: 'omit', headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error('GitHub contributors unavailable')
    const data: unknown = await response.json()
    if (!Array.isArray(data)) throw new Error('Invalid contributors response')
    for (const item of data) {
      if (!item || typeof item !== 'object' || !('login' in item) || typeof item.login !== 'string' || !item.login.trim()) {
        throw new Error('Invalid contributor')
      }
      contributors.push({ name: item.login, url: `https://github.com/${encodeURIComponent(item.login)}` })
    }
    if (!response.headers.get('link')?.includes('rel="next"')) {
      if (!contributors.length) throw new Error('Empty contributors response')
      return contributors
    }
  }
  throw new Error('Contributors response exceeds the supported page limit')
}

interface SpotlightRect {
  left: number
  top: number
  width: number
  height: number
}

function findTourTarget(selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) return element
  }
  return null
}

function computePopoverStyle(rect: SpotlightRect | null, placement: TourStep['placement'], popoverHeight: number): CSSProperties {
  if (!rect || typeof window === 'undefined') return {}
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 800
  const cardWidth = Math.min(380, vw - 32)
  const cardHeight = Math.max(260, popoverHeight)
  const clampX = (x: number) => Math.max(16, Math.min(vw - cardWidth - 16, x))
  const clampY = (y: number) => Math.max(5, Math.min(vh - cardHeight - 5, y))

  if (placement === 'right') {
    return { left: `${clampX(rect.left + rect.width + 16)}px`, top: `${clampY(rect.top + 16)}px` }
  }
  if (placement === 'left') {
    return { left: `${clampX(rect.left - cardWidth - 16)}px`, top: `${clampY(rect.top + 16)}px` }
  }
  if (placement === 'bottom-end') {
    return { left: `${clampX(rect.left + rect.width - cardWidth)}px`, top: `${clampY(rect.top + rect.height + 14)}px` }
  }
  if (placement === 'bottom') {
    return { left: `${clampX(rect.left)}px`, top: `${clampY(rect.top + rect.height + 14)}px` }
  }
  if (placement === 'top') {
    return { left: `${clampX(rect.left + (rect.width - cardWidth) / 2)}px`, top: `${clampY(rect.top - cardHeight - 14)}px` }
  }
  return {
    left: `${clampX(rect.left + (rect.width - cardWidth) / 2)}px`,
    top: `${clampY(rect.top + 32)}px`,
  }
}

export function AppInfoDialog({ kind, onClose }: Props) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null)
  const [popoverHeight, setPopoverHeight] = useState(320)
  const isTutorial = kind === INFO_DIALOG.TUTORIAL
  const [contributors, setContributors] = useState<typeof localContributors>([])
  const [creditsLoading, setCreditsLoading] = useState(true)
  const [localCredits, setLocalCredits] = useState(false)
  const [creditsKind, setCreditsKind] = useState(kind)
  if (creditsKind !== kind) {
    setCreditsKind(kind)
    if (!isTutorial) {
      setCreditsLoading(true)
      setLocalCredits(false)
      setContributors([])
    }
  }
  const title = isTutorial ? 'Tutorial' : 'About'
  const currentStep = TUTORIAL_STEPS[stepIndex] ?? TUTORIAL_STEPS[0]
  const panels = useSettingsStore((s) => s.panels)

  useLayoutEffect(() => {
    if (!isTutorial) return
    const previousPanels = { ...useSettingsStore.getState().panels }
    const allShown = Object.fromEntries(PANEL_IDS.map((id) => [id, true])) as PanelVisibility
    useSettingsStore.getState().restorePanels(allShown)
    return () => {
      useSettingsStore.getState().restorePanels(previousPanels)
    }
  }, [isTutorial])

  useEffect(() => {
    if (isTutorial) return
    const controller = new AbortController()
    let active = true
    const fallback = () => {
      if (!active) return
      setContributors(localContributors)
      setLocalCredits(true)
      setCreditsLoading(false)
    }
    const timeout = window.setTimeout(() => { fallback(); controller.abort() }, 8000)
    // Defer until effect replay settles so StrictMode does not send a duplicate request.
    void Promise.resolve().then(() => {
      if (!active) return
      return fetchContributors(controller.signal).then((result) => {
        if (active && !controller.signal.aborted) {
          setContributors(result)
          setCreditsLoading(false)
        }
      }).catch(fallback).finally(() => window.clearTimeout(timeout))
    })
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [isTutorial])

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useLayoutEffect(() => {
    if (!isTutorial) return
    const measure = () => {
      const cardHeight = popoverRef.current?.getBoundingClientRect().height
      if (cardHeight && cardHeight > 0) {
        setPopoverHeight((prev) => (Math.abs(prev - cardHeight) > 1 ? cardHeight : prev))
      }
      const target = findTourTarget(currentStep.selectors)
      const rect = target?.getBoundingClientRect()
      if (rect && rect.width > 0 && rect.height > 0) {
        setSpotlight({
          left: Math.max(2, rect.left - 4),
          top: Math.max(2, rect.top - 4),
          width: rect.width + 8,
          height: rect.height + 8,
        })
      } else {
        setSpotlight(null)
      }
    }
    measure()
    const raf = window.requestAnimationFrame(measure)
    const target = findTourTarget(currentStep.selectors)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (target) observer?.observe(target)
    if (popoverRef.current) observer?.observe(popoverRef.current)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [isTutorial, currentStep, panels])

  if (isTutorial) {
    const isLast = stepIndex === TUTORIAL_STEPS.length - 1
    return (
      <dialog
        ref={dialog}
        className={styles.tourOverlay}
        aria-labelledby="app-info-title"
        onCancel={(event) => { event.preventDefault(); onClose() }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' && !isLast) { event.preventDefault(); setStepIndex((i) => i + 1) }
          if (event.key === 'ArrowLeft' && stepIndex > 0) { event.preventDefault(); setStepIndex((i) => i - 1) }
        }}
      >
        <div
          data-tour-spotlight
          aria-hidden="true"
          className={spotlight ? styles.spotlight : styles.fullBackdrop}
          style={spotlight ? {
            left: `${spotlight.left}px`,
            top: `${spotlight.top}px`,
            width: `${spotlight.width}px`,
            height: `${spotlight.height}px`,
          } : undefined}
        />
        <section
          ref={popoverRef}
          className={`${styles.popover} ${spotlight ? styles.floatingPopover : ''}`}
          style={computePopoverStyle(spotlight, currentStep.placement, popoverHeight)}
          aria-label="Tutorial step"
        >
          <header className={styles.header}>
            <div>
              <span className={styles.stepBadge} role="status">{t('tutorial.step')} {stepIndex + 1} {t('common.of')} {TUTORIAL_STEPS.length}</span>
              <h2 id="app-info-title" className={styles.stepTitle}>{currentStep.title}</h2>
            </div>
            <button type="button" className={styles.dismiss} aria-label={`${t('common.close')} ${title}`} onClick={onClose}>×</button>
          </header>
          <p className={styles.tutorial}>{currentStep.description}</p>
          <p className={styles.howToUse}><strong>{t('tutorial.howToUse')}</strong> {currentStep.usage}</p>
          <div className={styles.dots} role="tablist" aria-label="Tutorial steps">
            {TUTORIAL_STEPS.map((step, index) => (
              <button
                key={step.title}
                type="button"
                role="tab"
                aria-selected={index === stepIndex}
                aria-label={`Step ${index + 1}: ${step.title}`}
                className={`${styles.dot} ${index === stepIndex ? styles.activeDot : ''}`}
                onClick={() => setStepIndex(index)}
              />
            ))}
          </div>
          <footer className={styles.tourFooter}>
            <button type="button" className={styles.skipButton} onClick={onClose}>{t('tutorial.skipTour')}</button>
            <div className={styles.navButtons}>
              {stepIndex > 0 && (
                <button type="button" onClick={() => setStepIndex((i) => i - 1)}>{t('tutorial.back')}</button>
              )}
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  if (isLast) onClose()
                  else setStepIndex((i) => i + 1)
                }}
              >
                {isLast ? t('tutorial.finish') : t('tutorial.next')}
              </button>
            </div>
          </footer>
        </section>
      </dialog>
    )
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="app-info-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <h2 id="app-info-title">{title}</h2>
      <button type="button" className={styles.dismiss} aria-label={`${t('common.close')} ${title}`} onClick={onClose}>×</button>
    </header>
    <div className={styles.content}>
      <section aria-label="Application information">
        <h3 className={styles.appName}>{productName}</h3>
        <p className={styles.muted}>{t('about.version')} {version}</p>
      </section>
      <AboutUpdates />
      <section aria-labelledby="app-contact-title">
        <h3 id="app-contact-title">{t('about.contact')}</h3>
        <a href="mailto:apps@jfespanolito.dev">apps@jfespanolito.dev</a>
        <a className={styles.github} href={PROJECT_URL} target="_blank" rel="noopener noreferrer" aria-label={`${productName} on GitHub`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 .1 1.68 1.92 3.3 1.18.1-.73.39-1.23.71-1.51-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.64 0c2.15-1.46 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.27-5.15 5.55.41.35.77 1.04.77 2.09v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
          </svg>
          <span>{t('about.githubProject')}</span>
        </a>
        <div className={styles.feedbackLinks}>
          <a href={urlGithubBugReport} target="_blank" rel="noopener noreferrer">{t('about.reportBug')}</a>
          <span aria-hidden="true" className={styles.bullet}>·</span>
          <a href={urlGithubFeatureRequest} target="_blank" rel="noopener noreferrer">{t('about.requestFeature')}</a>
          <span aria-hidden="true" className={styles.bullet}>·</span>
          <a href={urlPrivacyPolicy} target="_blank" rel="noopener noreferrer">{t('about.privacyPolicy')}</a>
        </div>
      </section>
      <section aria-labelledby="app-credits-title">
        <h3 id="app-credits-title">{t('about.credits')}</h3>
        <div id="app-contributors">
          <p role="status" className={styles.muted}>{creditsLoading
            ? t('about.loadingContributors')
            : localCredits ? t('about.fallbackContributors') : t('about.onlineContributors')}</p>
          {!creditsLoading && <ul aria-label={t('about.contributorsAria')}>
            {contributors.map((contributor) => <li key={contributor.url}>
              <a href={contributor.url} target="_blank" rel="noopener noreferrer">{contributor.name}</a>
            </li>)}
          </ul>}
        </div>
      </section>
    </div>
    <footer className={styles.footer}><button type="button" onClick={onClose}>{t('common.close')}</button></footer>
  </dialog>
}
