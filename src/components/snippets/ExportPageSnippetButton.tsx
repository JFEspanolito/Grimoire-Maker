import { useState } from 'react'
import { useDocumentStore } from '../../stores/documentStore'
import { useTabStore } from '../../stores/tabStore'
import { SaveSnippetDialog } from './SaveSnippetDialog'
import styles from './ExportPageSnippetButton.module.css'
import { useTranslation } from '../../lib/i18n'

/** Secondary action of the properties side panel: saves the whole current page as a snippet. */
export function ExportPageSnippetButton() {
  const { t } = useTranslation()
  const body = useDocumentStore((state) => state.document.body)
  const active = useTabStore((state) => state.active)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const markdownPage = !active || /\.md$/i.test(active)
  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.button} disabled={!markdownPage || !body.trim()} onClick={() => setMarkdown(body)}>
        {t('snippets.exportPage')}
      </button>
      {markdown !== null && <SaveSnippetDialog markdown={markdown} onClose={() => setMarkdown(null)} />}
    </div>
  )
}
