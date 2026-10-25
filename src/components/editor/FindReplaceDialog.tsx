import { useEffect, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { findMatches, type SearchQuery } from './extensions/searchHighlight'
import styles from './FindReplaceDialog.module.css'

/** Find and replace for the active page. Matches are highlighted in the page behind the dialog. */
export function FindReplaceDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [term, setTerm] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const query: SearchQuery = { term, caseSensitive }
  const matches = useEditorState({ editor, selector: ({ editor: e }) => findMatches(e.state.doc, query), equalityFn: (a, b) => a === b ? true : !!a && !!b && a.length === b.length && a.every((m, i) => m.from === b[i].from && m.to === b[i].to) })

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      if (!editor.isDestroyed) editor.commands.setSearch({ term: '', caseSensitive: false })
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [editor])
  useEffect(() => { editor.commands.setSearch({ term, caseSensitive }) }, [editor, term, caseSensitive])

  const select = (match: { from: number; to: number } | undefined) => {
    if (match) editor.chain().setTextSelection(match).scrollIntoView().run()
  }
  const step = (direction: 1 | -1) => {
    if (!matches.length) return
    const { from, to } = editor.state.selection
    const target = direction === 1
      ? matches.find((match) => match.from >= to) ?? matches[0]
      : [...matches].reverse().find((match) => match.to <= from) ?? matches[matches.length - 1]
    select(target)
  }
  const replaceCurrent = () => {
    const { from, to } = editor.state.selection
    const selected = matches.find((match) => match.from === from && match.to === to)
    if (!selected) return step(1)
    editor.chain().command(({ tr }) => { tr.insertText(replacement, selected.from, selected.to); return true }).run()
    const after = findMatches(editor.state.doc, query).find((match) => match.from >= selected.from + replacement.length)
    select(after)
  }
  const replaceAll = () => {
    editor.chain().command(({ tr }) => {
      for (const match of [...matches].reverse()) tr.insertText(replacement, match.from, match.to)
      return true
    }).run()
  }

  return <dialog ref={dialog} className={styles.dialog} aria-label="Find and replace"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header>
      <h2>Find and Replace</h2>
      <button type="button" aria-label="Close Find and Replace" onClick={onClose}>×</button>
    </header>
    <label>Find
      <input autoFocus value={term} onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1) } }} />
    </label>
    <label>Replace with
      <input value={replacement} onChange={(event) => setReplacement(event.target.value)} />
    </label>
    <label className={styles.check}><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />Match case</label>
    <p role="status">{term ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'Type to search this page'}</p>
    <div className={styles.actions}>
      <button type="button" disabled={!matches.length} onClick={() => step(-1)}>Previous</button>
      <button type="button" disabled={!matches.length} onClick={() => step(1)}>Next</button>
      <button type="button" disabled={!matches.length} onClick={replaceCurrent}>Replace</button>
      <button type="button" disabled={!matches.length} onClick={replaceAll}>Replace All</button>
    </div>
  </dialog>
}
