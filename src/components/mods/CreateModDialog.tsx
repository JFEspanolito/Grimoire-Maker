import { useEffect, useRef, useState } from 'react'
import { useTranslation, type TranslationKey } from '../../lib/i18n'
import { CreateModSnippets } from './CreateModSnippets'
import { CreateModTemplates } from './CreateModTemplates'
import { CreateModThemes } from './CreateModThemes'
import styles from './CreateMod.module.css'

export const CREATE_MOD_TABS = ['Themes', 'Snippets', 'Templates'] as const
export type CreateModTab = (typeof CREATE_MOD_TABS)[number]

const TAB_LABELS: Record<CreateModTab, TranslationKey> = {
  Themes: 'mod.themes',
  Snippets: 'mod.snippets',
  Templates: 'mod.templates',
}
interface Props {
  initialTab?: CreateModTab
  onClose: () => void
  /** Closes this window and opens the existing Customize Theme flow. */
  onOpenThemeCustomizer: () => void
}

/** Modal with one tab per kind of mod the user can create and export. */
export function CreateModDialog({ initialTab = 'Themes', onClose, onOpenThemeCustomizer }: Props) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<CreateModTab>(initialTab)

  useEffect(() => {
    const element = dialog.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => { element?.close(); opener?.focus?.() }
  }, [])

  const moveTab = (event: React.KeyboardEvent, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % CREATE_MOD_TABS.length
      : event.key === 'ArrowLeft' ? (index + CREATE_MOD_TABS.length - 1) % CREATE_MOD_TABS.length : null
    if (next === null) return
    event.preventDefault()
    setTab(CREATE_MOD_TABS[next])
    dialog.current?.querySelector<HTMLButtonElement>(`#create-mod-tab-${CREATE_MOD_TABS[next]}`)?.focus()
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="create-mod-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <header className={styles.header}>
        <h2 id="create-mod-title">{t('createMod.title')}</h2>
        <button type="button" onClick={onClose} aria-label={t('createMod.close')}>×</button>
      </header>
      <div className={styles.tabs} role="tablist" aria-label={t('createMod.kindOfMod')}>
        {CREATE_MOD_TABS.map((item, index) => (
          <button key={item} type="button" role="tab" id={`create-mod-tab-${item}`} aria-controls={`create-mod-panel-${item}`}
            aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={(event) => moveTab(event, index)}>
            {t(TAB_LABELS[item])}
          </button>
        ))}
      </div>
      {/* Every panel stays mounted so a half-filled form survives a tab switch. */}
      <div role="tabpanel" id="create-mod-panel-Themes" aria-labelledby="create-mod-tab-Themes" hidden={tab !== 'Themes'}>
        <CreateModThemes onOpenThemeCustomizer={onOpenThemeCustomizer} />
      </div>
      <div role="tabpanel" id="create-mod-panel-Snippets" aria-labelledby="create-mod-tab-Snippets" hidden={tab !== 'Snippets'}>
        <CreateModSnippets />
      </div>
      <div role="tabpanel" id="create-mod-panel-Templates" aria-labelledby="create-mod-tab-Templates" hidden={tab !== 'Templates'}>
        <CreateModTemplates />
      </div>
    </dialog>
  )
}
