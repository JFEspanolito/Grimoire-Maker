import { projectName } from '../../lib/binder'
import { useEffect, useState } from 'react'
import { useDocumentStore } from '../../stores/documentStore'
import { EMPTY_ENTRY, useProjectStore } from '../../stores/projectStore'
import styles from './ProjectSettings.module.css'
import { CONTRIBUTOR_GROUPS, type ContributorGroup } from '../../lib/projectContributors'
import { ContributorsDialog } from './ContributorsDialog'
import { DocumentOrderDialog } from './DocumentOrderDialog'

export function ProjectSettings() {
  const root = useDocumentStore(state => state.workspaceRoot)
  return root ? <ProjectFields key={root} root={root} /> : <p>Open a project to edit its properties.</p>
}

function ProjectFields({ root }: { root: string }) {
  const entry = useProjectStore(state => state.entries[root] ?? EMPTY_ENTRY)
  const [draft, setDraft] = useState(entry.settings)
  const [saved, setSaved] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ContributorGroup | null>(null)
  const [orderOpen, setOrderOpen] = useState(false)
  useEffect(() => {
    if (!useProjectStore.getState().entries[root]?.ready) void useProjectStore.getState().load(root)
  }, [root])
  useEffect(() => { setDraft(entry.settings) }, [entry.settings])
  const persist = async () => {
    const current = useProjectStore.getState().entries[root]
    if (!current?.ready || current.busy) return false
    if (draft.name === current.settings.name && draft.author === current.settings.author) return true
    const success = await useProjectStore.getState().save(root, { ...current.settings, name: draft.name, author: draft.author })
    setSaved(success)
    return success
  }
  return <><form className={styles.form} onSubmit={async event => {
    event.preventDefault()
    await persist()
  }}>
    <p>Shared by every page in this project. Changes save when a field loses focus. Book name never renames the folder.</p>
    {([['name', 'Book name'], ['author', 'Author']] as const).map(([key, label]) =>
      <label key={key}>{label}<input aria-label={label} value={draft[key]} placeholder={key === 'name' ? projectName(root) : undefined} maxLength={500} disabled={!entry.ready || entry.busy} onBlur={event => {
        if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute('data-contributors'))) void persist()
      }}
        onChange={event => { setSaved(false); setDraft({ ...draft, [key]: event.target.value }) }} /></label>)}
    <div className={styles.creditLinks}>{(Object.keys(CONTRIBUTOR_GROUPS) as ContributorGroup[]).map(group =>
      <button key={group} type="button" className={styles.creditLink} aria-label={CONTRIBUTOR_GROUPS[group]} aria-haspopup="dialog" data-contributors
        disabled={!entry.ready || entry.busy} onClick={async () => { if (await persist()) setEditingGroup(group) }}>
        {CONTRIBUTOR_GROUPS[group]} ({entry.settings[group]?.length ?? (group === 'coAuthors' && entry.settings.coAuthor ? 1 : 0)})
      </button>)}
      <button type="button" className={styles.creditLink} aria-haspopup="dialog" disabled={!entry.ready || entry.busy}
        onClick={async () => { if (await persist()) setOrderOpen(true) }}>Document Order…</button></div>
    {entry.error && <p role="alert">{entry.error}</p>}
    {!entry.ready && !entry.busy && <button type="button" onClick={() => void useProjectStore.getState().load(root)}>Retry project settings</button>}
    <button type="submit" disabled={!entry.ready || entry.busy}>{entry.busy ? 'Working…' : 'Save project settings'}</button>
    {saved && <p role="status">Project settings saved.</p>}
  </form>
    {orderOpen && <DocumentOrderDialog root={root} onClose={() => setOrderOpen(false)} />}
    {editingGroup && <ContributorsDialog title={CONTRIBUTOR_GROUPS[editingGroup]}
      initial={entry.settings[editingGroup] ?? (editingGroup === 'coAuthors' && entry.settings.coAuthor
        ? [{ name: entry.settings.coAuthor, socialMedia: '', platform: '' }] : [])}
      busy={entry.busy} error={entry.error} onClose={() => setEditingGroup(null)}
      onSave={async contributors => {
        const current = useProjectStore.getState().entries[root]
        const success = await useProjectStore.getState().save(root, { ...current.settings, [editingGroup]: contributors })
        setSaved(success)
        return success
      }} />}
  </>
}
