import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import configSource from '../../../src-tauri/tauri.conf.json?raw'
import packageSource from '../../../package.json?raw'
import styles from './AppInfoDialog.module.css'
import { localContributors, urlGithubRepo } from '../../data/contributors'

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

interface TourStep {
  title: string
  selectors: readonly string[]
  placement: 'right' | 'center' | 'bottom' | 'bottom-end' | 'left'
  description: string
  usage: string
}

export const TUTORIAL_STEPS: readonly TourStep[] = [
  {
    title: 'Project Files, Templates & Git',
    selectors: ['[data-tour="project-sidebar"]', 'aside'],
    placement: 'right',
    description: 'Organize your manual in Draft, Research, and Trash, start from ready-made book Templates, and record local history with Git · Source control.',
    usage: 'Use + File or + Folder to create content, drag files between folders, open images/PDF/DOCX in read-only preview tabs, or commit changes in the Git panel.',
  },
  {
    title: 'Tabs, Split View & Page Editor',
    selectors: ['[data-tour="editor-workspace"]', 'main'],
    placement: 'center',
    description: 'Write in Markdown directly on physical sheets with independent multi-tab editing, side-by-side Split View, and 1 or 2 column layouts.',
    usage: 'Click any sheet to start writing, open multiple documents in tabs, or use View → Split View and Columns to compare and lay out chapters.',
  },
  {
    title: 'Formatting, Images & Alignment Guides',
    selectors: ['[role="toolbar"][aria-label="Formatting"]'],
    placement: 'bottom',
    description: 'Apply headings, lists, and emphasis, insert illustrations with text wrap or free placement, and add millimetre alignment guides.',
    usage: 'Click Image to import illustrations (use Push text to wrap paragraphs or Over text to drag across pages) and open Guides to add + Row or + Column lines.',
  },
  {
    title: 'Page View, Zoom & Print Ruler',
    selectors: ['[role="group"][aria-label="Editor tools"]'],
    placement: 'bottom-end',
    description: 'Inspect your book as single sheets or open-book facing spreads, scale the workspace, and verify physical margins and bleed.',
    usage: 'Switch Page view between Single page and Spread, change Zoom (or press Ctrl + mouse wheel), and toggle Ruler to inspect page measurements.',
  },
  {
    title: 'Snippets & Properties',
    selectors: ['[data-tour="snippets-sidebar"]'],
    placement: 'left',
    description: 'Insert reusable RPG blocks inside movable Content Boxes and configure global book credits or per-page layout overrides.',
    usage: 'Drag Snippets (Character Sheet, Statblock, Read-aloud, d6/d100 tables) onto a page, and edit book title, authors, artists, or page columns in Properties.',
  },
  {
    title: 'Themes, Mods & Export PDF',
    selectors: ['[aria-label="Application menu"]'],
    placement: 'bottom',
    description: 'Customize visual themes, manage installed mod packages, configure auto-save intervals, and publish your finished manual to PDF.',
    usage: 'Open Settings → Preferences or Mod Manager to customize themes and mods, and select File → Export PDF… to generate and open your print-ready PDF.',
  },
]

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

function computePopoverStyle(rect: SpotlightRect | null, placement: TourStep['placement']): CSSProperties {
  if (!rect || typeof window === 'undefined') return {}
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 800
  const cardWidth = Math.min(380, vw - 32)
  const clampX = (x: number) => Math.max(16, Math.min(vw - cardWidth - 16, x))
  const clampY = (y: number) => Math.max(16, Math.min(vh - 260, y))

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
  return {
    left: `${clampX(rect.left + (rect.width - cardWidth) / 2)}px`,
    top: `${clampY(rect.top + 32)}px`,
  }
}

export function AppInfoDialog({ kind, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null)
  const isTutorial = kind === INFO_DIALOG.TUTORIAL
  const [contributors, setContributors] = useState<typeof localContributors>([])
  const [creditsLoading, setCreditsLoading] = useState(true)
  const [localCredits, setLocalCredits] = useState(false)
  const title = isTutorial ? 'Interactive Tutorial' : 'About'
  const currentStep = TUTORIAL_STEPS[stepIndex] ?? TUTORIAL_STEPS[0]

  useEffect(() => {
    if (isTutorial) return
    const controller = new AbortController()
    let active = true
    setCreditsLoading(true)
    setLocalCredits(false)
    setContributors([])
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
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [isTutorial, currentStep])

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
          className={`${styles.popover} ${spotlight ? styles.floatingPopover : ''}`}
          style={computePopoverStyle(spotlight, currentStep.placement)}
          aria-label="Tutorial step"
        >
          <header className={styles.header}>
            <div>
              <span className={styles.stepBadge} role="status">Step {stepIndex + 1} of {TUTORIAL_STEPS.length}</span>
              <h2 id="app-info-title" className={styles.stepTitle}>{currentStep.title}</h2>
            </div>
            <button type="button" className={styles.dismiss} aria-label="Close Tutorial" onClick={onClose}>×</button>
          </header>
          <p className={styles.tutorial}>{currentStep.description}</p>
          <p className={styles.howToUse}><strong>How to use:</strong> {currentStep.usage}</p>
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
            <button type="button" className={styles.skipButton} onClick={onClose}>Skip Tour</button>
            <div className={styles.navButtons}>
              {stepIndex > 0 && (
                <button type="button" onClick={() => setStepIndex((i) => i - 1)}>Back</button>
              )}
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  if (isLast) onClose()
                  else setStepIndex((i) => i + 1)
                }}
              >
                {isLast ? 'Finish' : 'Next'}
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
      <button type="button" className={styles.dismiss} aria-label={`Close ${title}`} onClick={onClose}>×</button>
    </header>
    <div className={styles.content}>
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
        <div id="app-contributors">
          <p role="status" className={styles.muted}>{creditsLoading
            ? 'Loading contributors from GitHub…'
            : localCredits ? 'GitHub is unavailable. Showing bundled credits.' : 'Contributors from GitHub.'}</p>
          {!creditsLoading && <ul aria-label="Contributors">
            {contributors.map((contributor) => <li key={contributor.url}>
              <a href={contributor.url} target="_blank" rel="noopener noreferrer">{contributor.name}</a>
            </li>)}
          </ul>}
        </div>
      </section>
    </div>
    <footer className={styles.footer}><button type="button" onClick={onClose}>Close</button></footer>
  </dialog>
}
