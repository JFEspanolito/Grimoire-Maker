import { useId, useState } from 'react'
import { exportSnippet, exportSnippetPack } from '../../lib/modExport'
import { useModStore } from '../../stores/modStore'
import { saveSnippetAndRefresh, snippetDraftProblem, useSnippetCategories } from '../snippets/saveSnippet'
import { savedMessage, useAction } from './createModShared'
import type { TemplateSnippet } from '../../lib/templateSnippets'
import styles from './CreateMod.module.css'

/** Snippets tab: A packages existing snippets, B writes a new one into the local Snippets library. */
export function CreateModSnippets() {
  const snippets = useModStore((state) => state.snippets)
  const categories = useSnippetCategories()
  const list = useId()
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [markdown, setMarkdown] = useState('')
  const pack = useAction()
  const create = useAction()
  const groups = categories.map((group) => ({ group, items: snippets.filter((snippet) => snippet.group === group) }))
  const selected = picked.filter((id) => snippets.some((snippet) => snippet.id === id))

  const toggle = (id: string) => setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const exportOne = (snippet: TemplateSnippet) => void pack.run('mods.create.snippet-export', 'Could not export the snippet.', async () => {
    const result = await exportSnippet({ name: snippet.label, category: snippet.group, markdown: snippet.markdown })
    return result ? savedMessage('Snippet', result) : ''
  })
  const exportPack = () => void pack.run('mods.create.snippet-pack', 'Could not package the snippets.', async () => {
    const result = await exportSnippetPack(selected)
    return result ? savedMessage('Snippet pack', result) : ''
  })
  const save = () => {
    const problem = snippetDraftProblem({ name, category, markdown })
    if (problem) { create.setError(problem); return }
    void create.run('mods.create.snippet-save', 'Could not save the snippet.', async () => {
      const path = await saveSnippetAndRefresh({ name, category, markdown })
      setName('')
      setMarkdown('')
      return `Snippet saved to ${path}`
    })
  }

  return (
    <div className={styles.stack}>
      <section className={styles.block} aria-label="Existing snippets">
        <h4>Existing snippets</h4>
        {snippets.length === 0 ? <p className={styles.hint}>No snippets found yet. Create one below.</p> : groups.map(({ group, items }) => (
          <div key={group} role="group" aria-label={group} className={styles.group}>
            <strong>{group}</strong>
            {items.map((snippet) => (
              <div key={snippet.id} className={styles.snippetRow}>
                <label>
                  <input type="checkbox" aria-label={`Select snippet ${snippet.label}`} checked={selected.includes(snippet.id)}
                    disabled={pack.busy} onChange={() => toggle(snippet.id)} />
                  <span>{snippet.label}</span>
                </label>
                <button type="button" aria-label={`Export ${snippet.label} as .md`} disabled={pack.busy} onClick={() => exportOne(snippet)}>Export .md</button>
              </div>
            ))}
          </div>
        ))}
        <div className={styles.row}>
          <button type="button" className={styles.primary} disabled={pack.busy || selected.length === 0} onClick={exportPack}>Package selected as .zip</button>
        </div>
        {pack.status && <p role="status" className={styles.success}>{pack.status}</p>}
        {pack.error && <p role="alert" className={styles.error}>{pack.error}</p>}
      </section>

      <section className={styles.block} aria-label="New snippet">
        <h4>New snippet</h4>
        <label className={styles.field}>
          <span>Snippet Name</span>
          <input value={name} maxLength={80} disabled={create.busy} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Category / Folder</span>
          <input value={category} list={list} maxLength={60} placeholder="General" disabled={create.busy} onChange={(event) => setCategory(event.target.value)} />
          <datalist id={list}>{categories.map((item) => <option key={item} value={item} />)}</datalist>
        </label>
        <label className={styles.field}>
          <span>Markdown</span>
          <textarea className={styles.mono} rows={8} spellCheck={false} value={markdown}
            disabled={create.busy} onChange={(event) => setMarkdown(event.target.value)} />
        </label>
        <div className={styles.row}>
          <button type="button" className={styles.primary} disabled={create.busy} onClick={save}>Save to Snippets</button>
        </div>
        {create.status && <p role="status" className={styles.success}>{create.status}</p>}
        {create.error && <p role="alert" className={styles.error}>{create.error}</p>}
      </section>
    </div>
  )
}
