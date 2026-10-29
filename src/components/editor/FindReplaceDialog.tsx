import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { findMatches, type SearchMatch } from './extensions/searchHighlight'
import { useFileSystem } from '../../hooks/useFileSystem'
import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'
import {
  applyProjectReplace, ProjectChangedError, searchProject, selectInEditor, undoProjectReplace,
  type FileResult, type ProjectMatch, type ProjectSearch,
} from '../../lib/projectSearch'
import { buildMatcher, expandReplacement, MAX_MATCHES, type SearchOptions } from '../../lib/searchReplace'
import { autoCommitChanges } from '../../lib/versionControl'
import { useDocumentStore } from '../../stores/documentStore'
import { useFindStore } from '../../stores/findStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../lib/i18n'
import styles from './FindReplaceDialog.module.css'

// plural handled inside component via t()
const sameMatches = (a: SearchMatch[], b: SearchMatch[]) => a === b || (a.length === b.length && a.every((match, index) => match.from === b[index].from && match.to === b[index].to))

/**
 * Find and replace for the active page or for the whole project. A small floating panel: it never takes
 * over the page, so the user keeps typing in the document while it is open.
 */
export function FindReplaceDialog({ editor }: { editor: Editor | null }) {
  const open = useFindStore((state) => state.open)
  return open ? <FindPanel editor={editor} /> : null
}

function FindPanel({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation()
  const find = useFindStore()
  const { term, replacement, caseSensitive, wholeWord, regex, scope, replaceOpen } = find
  const query = useMemo<SearchOptions>(() => ({ term, caseSensitive, wholeWord, regex }), [term, caseSensitive, wholeWord, regex])
  const root = useDocumentStore((state) => state.workspaceRoot)
  const activeBody = useDocumentStore((state) => state.document.body)
  const { openFile } = useFileSystem()
  const findInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const matcherError = useMemo(() => buildMatcher(query).error ?? '', [query])

  /* ---- This file ---- */
  const [fileMatches, setFileMatches] = useState<SearchMatch[]>([])
  const refresh = useCallback(() => {
    const next = editor && !editor.isDestroyed ? findMatches(editor.state.doc, query) : []
    setFileMatches((previous) => sameMatches(previous, next) ? previous : next)
  }, [editor, query])
  useEffect(refresh, [refresh])
  // Typing in the page keeps the counter current, a moment after the last keystroke.
  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 150) }
    editor.on('update', later)
    return () => { editor.off('update', later); clearTimeout(timer) }
  }, [editor, refresh])
  // The page highlights the matches in both scopes (in Project scope: the ones in the file on screen).
  useEffect(() => { editor?.commands.setSearch(query) }, [editor, query])
  useEffect(() => () => { if (editor && !editor.isDestroyed) editor.commands.setSearch({ term: '', caseSensitive: false }) }, [editor])
  const selection = useEditorState({ editor, selector: ({ editor: e }) => e ? `${e.state.selection.from}:${e.state.selection.to}` : '' })

  const replacementFor = (match: SearchMatch) => regex && match.groups ? expandReplacement(replacement, match.groups) : replacement
  const select = (match: { from: number; to: number } | undefined) => {
    if (match && editor) editor.chain().setTextSelection(match).scrollIntoView().run()
  }
  const stepFile = (direction: 1 | -1) => {
    if (!editor || !fileMatches.length) return
    const { from, to } = editor.state.selection
    select(direction === 1
      ? fileMatches.find((match) => match.from >= to) ?? fileMatches[0]
      : [...fileMatches].reverse().find((match) => match.to <= from) ?? fileMatches[fileMatches.length - 1])
  }
  const replaceCurrentInFile = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const selected = fileMatches.find((match) => match.from === from && match.to === to)
    if (!selected) return stepFile(1)
    const text = replacementFor(findMatches(editor.state.doc, query).find((match) => match.from === from && match.to === to) ?? selected)
    editor.chain().command(({ tr }) => { tr.insertText(text, selected.from, selected.to); return true }).run()
    refresh()
    select(findMatches(editor.state.doc, query).find((match) => match.from >= selected.from + text.length))
  }
  const replaceAllInFile = () => {
    if (!editor) return
    editor.chain().command(({ tr }) => {
      for (const match of findMatches(tr.doc, query).reverse()) tr.insertText(replacementFor(match), match.from, match.to)
      return true
    }).run()
    refresh()
  }

  /* ---- Project ---- */
  const [search, setSearch] = useState<ProjectSearch | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set())
  const [current, setCurrent] = useState(-1)
  const [confirm, setConfirm] = useState<{ versioned: boolean } | null>(null)
  const [rerun, setRerun] = useState(0)
  const sequence = useRef(0)
  const pending = useRef<{ match: ProjectMatch; text: string; from: Editor | null } | null>(null)
  const lastReplace = find.lastReplace
  const flat = useMemo(() => search?.files.flatMap((file) => file.matches) ?? [], [search])
  const selectedIds = useMemo(() => new Set(flat.filter((match) => !unchecked.has(match.id)).map((match) => match.id)), [flat, unchecked])
  const selectedFiles = useMemo(() => (search?.files ?? []).filter((file) => file.matches.some((match) => selectedIds.has(match.id))).length, [search, selectedIds])

  useEffect(() => {
    setConfirm(null)
    if (scope !== 'project' || !root || !term) { setSearch(null); setBusy(false); return }
    const id = ++sequence.current
    setBusy(true)
    const timer = setTimeout(() => {
      searchProject(root, query).then((result) => {
        if (sequence.current !== id) return
        const ids = new Set(result.files.flatMap((file) => file.matches.map((match) => match.id)))
        setSearch(result)
        setUnchecked((previous) => new Set([...previous].filter((key) => ids.has(key))))
        setCurrent(-1)
        setBusy(false)
      }).catch((error: unknown) => {
        if (sequence.current !== id) return
        reportError('find.project', error)
        setSearch(null)
        setMessage(friendlyErrorMessage(error))
        setBusy(false)
      })
    }, 200)
    // A newer search (or closing the panel) cancels this one: its result is never applied.
    return () => { clearTimeout(timer); sequence.current++ }
  }, [scope, root, term, query, rerun, activeBody])

  const relative = (path: string) => root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  const jump = async (match: ProjectMatch) => {
    if (!search) return
    const doc = search.docs.find((candidate) => candidate.path === match.path)
    if (!doc) return
    const text = doc.body.slice(match.start, match.end)
    setCurrent(flat.indexOf(match))
    if (editor && useTabStore.getState().active === match.path) { selectInEditor(editor, query, match, text); return }
    pending.current = { match, text, from: editor }
    try { await openFile(match.path) } catch (error) { pending.current = null; setMessage(friendlyErrorMessage(error)) }
  }
  // The file opens asynchronously; its editor arrives as a new `editor`, and the selection happens then.
  useEffect(() => {
    const wanted = pending.current
    if (!wanted || !editor || editor === wanted.from) return
    if (useDocumentStore.getState().document.path !== wanted.match.path) return
    pending.current = null
    selectInEditor(editor, query, wanted.match, wanted.text)
  }, [editor, query])

  const stepProject = (direction: 1 | -1) => {
    if (!flat.length) return
    const next = current < 0 ? (direction === 1 ? 0 : flat.length - 1) : (current + direction + flat.length) % flat.length
    void jump(flat[next])
  }
  const runReplace = async (ids: ReadonlySet<string>) => {
    if (!search || !root) return null
    try {
      const { changes, matches } = await applyProjectReplace(root, search, query, replacement, ids)
      setMessage(matches ? `${t('find.replaced')} ${plural(matches)} ${t('find.in')} ${files(changes.length)}.` : t('find.nothingToReplace'))
      return changes
    } catch (error) {
      setMessage(error instanceof ProjectChangedError ? error.message : friendlyErrorMessage(error))
      return null
    } finally {
      setConfirm(null)
      setRerun((count) => count + 1)
    }
  }
  const replaceFile = (file: FileResult) => void runReplace(new Set(file.matches.filter((match) => selectedIds.has(match.id)).map((match) => match.id)))
  const replaceCurrentInProject = () => {
    const match = flat[current]
    if (match) void runReplace(new Set([match.id]))
    else stepProject(1)
  }
  const askReplaceAll = async () => {
    if (!root) return
    setMessage('')
    // A safety commit first; without a repository the user is told this cannot be undone through git.
    let versioned = true
    try {
      const result = await autoCommitChanges(root, 'Before replace all')
      versioned = result !== 'noRepository' && result !== 'gitUnavailable'
    } catch (error) {
      reportError('find.autoCommit', error)
      versioned = false
    }
    setConfirm({ versioned })
  }
  const replaceAllInProject = async () => {
    const changes = await runReplace(selectedIds)
    if (changes?.length) find.setLastReplace(changes)
  }
  const undoReplace = async () => {
    if (!root || !lastReplace) return
    try {
      const { restored, skipped } = await undoProjectReplace(root, lastReplace)
      setMessage(`${t('find.restored')} ${files(restored)}.${skipped.length ? ` ${t('find.skippedSince')} ${skipped.map(relative).join(', ')}.` : ''}`)
      find.setLastReplace(null)
    } catch (error) {
      setMessage(friendlyErrorMessage(error))
    }
    setRerun((count) => count + 1)
  }

  /* ---- Shared behaviour ---- */
  const step = (direction: 1 | -1) => scope === 'project' ? stepProject(direction) : stepFile(direction)
  const stepRef = useRef(step)
  stepRef.current = step
  const handledStep = useRef(find.step.token)
  useEffect(() => {
    if (find.step.token === handledStep.current) return
    handledStep.current = find.step.token
    stepRef.current(find.step.direction)
  }, [find.step])
  useEffect(() => {
    const field = find.focusTarget === 'replace' ? replaceInput.current : findInput.current
    field?.focus()
    field?.select()
  }, [find.focusToken, find.focusTarget])

  const close = () => {
    find.hide()
    if (editor && !editor.isDestroyed) editor.commands.focus()
  }
  const projectScope = scope === 'project'
  const count = projectScope ? flat.length : fileMatches.length
  const truncated = projectScope ? !!search?.truncated : fileMatches.length >= MAX_MATCHES
  const noEditor = !projectScope && !editor
  const canReplaceAll = count > 0 && !truncated && (!projectScope || selectedIds.size > 0)
  const position = fileMatches.findIndex((match) => `${match.from}:${match.to}` === selection)
  const plural = (c: number) => `${c} ${c === 1 ? t('find.match') : t('find.matches')}`
  const files = (c: number) => `${c} ${c === 1 ? t('find.file') : t('find.files')}`
  const status = !term
    ? (projectScope ? t('find.typeToSearchProject') : t('find.typeToSearchPage'))
    : noEditor ? t('find.openMarkdownToSearch')
      : matcherError ? ''
        : projectScope
          ? busy && !search ? t('find.searching')
            : `${truncated ? `${MAX_MATCHES}+ ${t('find.matches')}` : plural(flat.length)}${flat.length ? ` ${t('find.in')} ${files(search?.files.length ?? 0)}` : ''}`
          : truncated ? `${MAX_MATCHES}+ ${t('find.matches')}`
            : position >= 0 ? `${position + 1} ${t('common.of')} ${fileMatches.length}` : plural(fileMatches.length)

  return <dialog open data-find-panel="" className={styles.dialog} aria-label={t('find.title')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
    <header>
      <h2>{t('find.title')}</h2>
      <button type="button" aria-label={t('find.close')} onClick={close}>×</button>
    </header>
    <div className={styles.scope} role="group" aria-label={t('find.searchIn')}>
      {(['file', 'project'] as const).map((value) => <button key={value} type="button" aria-pressed={scope === value}
        onClick={() => find.set({ scope: value })}>{value === 'file' ? t('find.thisFile') : t('find.project')}</button>)}
    </div>
    <div className={styles.fields}>
      <button type="button" className={styles.toggle} aria-expanded={replaceOpen} aria-label={replaceOpen ? t('find.hideReplace') : t('find.showReplace')}
        onClick={() => find.set({ replaceOpen: !replaceOpen })}>{replaceOpen ? '▾' : '▸'}</button>
      <label>{t('find.findLabel')}
        <input ref={findInput} value={term} onChange={(event) => find.set({ term: event.target.value })}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1) } }} />
      </label>
      {replaceOpen && <label>{t('find.replaceWithLabel')}
        <input ref={replaceInput} value={replacement} onChange={(event) => find.set({ replacement: event.target.value })} />
      </label>}
    </div>
    <div className={styles.options}>
      <label className={styles.check}><input type="checkbox" checked={caseSensitive} onChange={(event) => find.set({ caseSensitive: event.target.checked })} />{t('find.matchCase')}</label>
      <label className={styles.check}><input type="checkbox" checked={wholeWord} onChange={(event) => find.set({ wholeWord: event.target.checked })} />{t('find.wholeWord')}</label>
      <label className={styles.check}><input type="checkbox" checked={regex} onChange={(event) => find.set({ regex: event.target.checked })} />{t('find.regex')}</label>
    </div>
    <p role="status">{status}</p>
    {matcherError && term && <p role="alert" className={styles.error}>{matcherError}</p>}
    {truncated && <p className={styles.note}>{t('find.tooManyMatches')}</p>}
    {projectScope && <p className={styles.note}>{t('find.projectScopeNote')}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={!count} onClick={() => step(-1)}>{t('find.previous')}</button>
      <button type="button" disabled={!count} onClick={() => step(1)}>{t('find.next')}</button>
      <button type="button" disabled={!count} onClick={projectScope ? replaceCurrentInProject : replaceCurrentInFile}>{t('find.replace')}</button>
      <button type="button" disabled={!canReplaceAll} onClick={projectScope ? () => void askReplaceAll() : replaceAllInFile}>
        {projectScope ? `${t('find.replaceAll')} (${plural(selectedIds.size)} ${t('find.in')} ${files(selectedFiles)})` : t('find.replaceAll')}
      </button>
    </div>
    {confirm && <div className={styles.confirm} role="group" aria-label={t('find.confirmReplaceAll')}>
      <p>{t('find.replace')} {plural(selectedIds.size)} {t('find.in')} {files(selectedFiles)}? {confirm.versioned
        ? t('find.versionedNotice')
        : t('find.unversionedNotice')}</p>
      <button type="button" onClick={() => void replaceAllInProject()}>{t('find.yesReplaceAll')}</button>
      <button type="button" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
    </div>}
    {projectScope && lastReplace && <button type="button" onClick={() => void undoReplace()}>{t('find.undoLastReplace')}</button>}
    {projectScope && message && <p role="status" className={styles.note}>{message}</p>}
    {projectScope && search && <div className={styles.results} aria-label={t('find.projectResults')}>
      {search.files.map((file) => <section key={file.path}>
        <h3><span title={file.path}>{relative(file.path)}</span> <small>{file.matches.length}</small>
          <button type="button" onClick={() => replaceFile(file)}>{t('find.replaceInFile')}</button></h3>
        <ul>{file.matches.map((match) => <li key={match.id} data-current={flat[current] === match}>
          <input type="checkbox" aria-label={`${t('find.includeMatch')} ${match.line} ${t('common.of')} ${relative(file.path)}`} checked={!unchecked.has(match.id)}
            onChange={(event) => setUnchecked((previous) => { const next = new Set(previous); if (event.target.checked) next.delete(match.id); else next.add(match.id); return next })} />
          <button type="button" className={styles.hit} onClick={() => void jump(match)}>
            <span>{match.line}</span>{match.context.slice(0, match.contextStart)}<mark>{match.context.slice(match.contextStart, match.contextEnd)}</mark>{match.context.slice(match.contextEnd)}
          </button>
          <button type="button" onClick={() => void runReplace(new Set([match.id]))}>{t('find.replaceHere')}</button>
        </li>)}</ul>
      </section>)}
    </div>}
  </dialog>
}
