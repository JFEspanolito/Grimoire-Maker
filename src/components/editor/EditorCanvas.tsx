import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { isDocumentRestoring, useDocumentStore } from '../../stores/documentStore'
import { emitPluginEvent, setPluginHost, usePluginRegistry } from '../../plugins/plugin-manager'
import type { PluginContextAction, PluginContextActionContext } from '../../types/plugin'
import { contextActionApplies, runContextAction } from '../../lib/pluginContextActions'
import { PageView } from './PageView'
import { EDITOR_EXTENSIONS } from './editorExtensions'
import { DocumentPathContext } from './DocumentPathContext'
import { registerSnippetDropTarget } from '../../lib/snippetDrop'
import { focusDocumentEnd, insertContentBox } from '../../lib/contentBoxes'
import { EditorContextMenu, type EditorMenuItem } from './EditorContextMenu'
import { selectionMarkdown } from './selectionMarkdown'
import { SaveSnippetDialog } from '../snippets/SaveSnippetDialog'
import { ConfirmDialog } from '../layout/ConfirmDialog'
import { continueListNumbering, getPreviousOrderedList, restartListNumbering, setListStart } from './extensions/blockFormat'
import { useTranslation } from '../../lib/i18n'
import { useFormatPainterStore } from '../../stores/formatPainterStore'

function getMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
}

interface Props {
  onReady: (editor: Editor) => void
  path?: string | null
  active?: boolean
}

export function EditorCanvas({ onReady, path, active = true }: Props) {
  const { t } = useTranslation()
  const isFormatPainterArmed = useFormatPainterStore((s) => s.armed)
  const body = useDocumentStore((s) => path === undefined ? s.document.body : (s.buffers[path ?? '__untitled__']?.body ?? ''))
  const activePath = useDocumentStore((s) => s.document.path)
  const documentPath = path === undefined ? activePath : path

  const [menu, setMenu] = useState<{ x: number; y: number; markdown: string; actions: PluginContextAction[]; listActions: EditorMenuItem[]; context: PluginContextActionContext } | null>(null)
  const [snippetMarkdown, setSnippetMarkdown] = useState<string | null>(null)
  const [startNumber, setStartNumber] = useState<string | null>(null)

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: body,
    editorProps: {
      attributes: { spellcheck: 'false' },
    },
    onUpdate: ({ editor: e }) => {
      const store = useDocumentStore.getState()
      const target = path === undefined ? store.document.path : path
      if (isDocumentRestoring(store, target)) {
        const current = store.document.path === target ? store.document : store.buffers[target ?? '__untitled__']
        e.commands.setContent(current?.body ?? '', { emitUpdate: false })
        return
      }
      store.setBodyForPath(path === undefined ? store.document.path : path, getMarkdown(e))
      emitPluginEvent('document:changed')
    },
  })

  useEffect(() => {
    if (!editor) return
    const sync = () => {
      if (editor.isDestroyed) return
      const store = useDocumentStore.getState()
      const restoring = isDocumentRestoring(store, documentPath ?? null)
      editor.setEditable(!restoring, false)
      if (restoring) {
        const current = store.document.path === documentPath ? store.document : store.buffers[documentPath ?? '__untitled__']
        if (current && getMarkdown(editor) !== current.body) editor.commands.setContent(current.body, { emitUpdate: false })
      }
    }
    sync()
    return useDocumentStore.subscribe(sync)
  }, [editor, documentPath])

  useEffect(() => editor ? registerSnippetDropTarget(editor, documentPath ?? null) : undefined, [editor, documentPath])

  useEffect(() => {
    if (!editor || !active) return
    onReady(editor)
    setPluginHost({
      getActiveBody: () => getMarkdown(editor),
      insertContent: (markdown) => insertContentBox(editor, markdown),
    })
    return () => setPluginHost({ getActiveBody: () => '', insertContent: () => {} })
  }, [editor, onReady, active])

  // External body changes (file open) reload the editor; own edits are no-ops.
  useEffect(() => {
    if (editor && getMarkdown(editor) !== body) editor.commands.setContent(body, { emitUpdate: false })
  }, [editor, body])

  const focusWritingArea = (event: MouseEvent<HTMLDivElement>) => {
    if (!editor || event.button !== 0 || !(event.target instanceof Element)) return
    const target = event.target
    if (target.closest('button, input, select, textarea, a, [contenteditable="false"]')) return

    // If clicking in the blank space of a section below its last element (e.g. below a table or box)
    const sectionEl = target.closest<HTMLElement>('.grimoire-section')
    if (sectionEl) {
      const lastChildEl = Array.from(sectionEl.children).filter(el => !el.hasAttribute('data-section-layout-probe') && !el.classList.contains('ProseMirror-trailingBreak')).at(-1)
      const clickedBelow = !lastChildEl || event.clientY > lastChildEl.getBoundingClientRect().bottom
      const isBareSectionClick = target === sectionEl || target.classList.contains('ProseMirror')

      if (clickedBelow && (isBareSectionClick || target === sectionEl)) {
        event.preventDefault()
        try {
          const pos = editor.view.posAtDOM(sectionEl, 0)
          const $pos = editor.state.doc.resolve(pos)
          const sectionDepth = $pos.depth >= 1 ? 1 : 0
          const sectionNode = $pos.node(sectionDepth)
          const lastBlock = sectionNode.lastChild
          const endPos = $pos.end(sectionDepth)
          if (lastBlock && (lastBlock.type.name !== 'paragraph' || lastBlock.content.size > 0)) {
            const tr = editor.state.tr.insert(endPos, editor.schema.nodes.paragraph.create())
            tr.setSelection(TextSelection.create(tr.doc, endPos + 1))
            editor.view.dispatch(tr)
            editor.view.focus()
            return
          } else if (lastBlock) {
            const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, endPos - 1))
            editor.view.dispatch(tr)
            editor.view.focus()
            return
          }
        } catch {
          // Fall through to general focus handler
        }
      }
    }

    const insideProseMirror = target !== editor.view.dom && !!target.closest('.ProseMirror')
    if (insideProseMirror) {
      const isBareContainer = target.classList.contains('grimoire-section') || target.classList.contains('ProseMirror')
      if (!isBareContainer) return
      const lastBox = Array.from(target.querySelectorAll<HTMLElement>(':scope > .grimoire-content-box, :scope > .node-standardContentBox')).at(-1)
      if (!lastBox || event.clientY <= lastBox.getBoundingClientRect().bottom) return
    }
    event.preventDefault()
    const inContentBox = (() => {
      const { $from } = editor.state.selection
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'standardContentBox') return true
      }
      return false
    })()
    const lastSection = editor.state.doc.lastChild
    const lastBlock = (lastSection?.type.name === 'section' ? lastSection : editor.state.doc).lastChild
    if (inContentBox || (lastBlock && lastBlock.type.name !== 'paragraph')) {
      focusDocumentEnd(editor)
      return
    }
    editor.commands.focus(editor.state.selection instanceof TextSelection ? undefined : 'end', { scrollIntoView: false })
  }

  const closeMenu = useCallback((restoreFocus?: boolean) => {
    setMenu(null)
    if (restoreFocus) editor?.commands.focus(null, { scrollIntoView: false })
  }, [editor])

  // One menu for the whole editor. The listener runs in the capture phase on the editor itself, so it sees
  // the right-click before any listener a plugin attached to the page and stops it there: plugins add
  // items through `registerContextAction` and can never open a second menu. With nothing to offer (no
  // saveable selection or block and no plugin item for this click) the native menu stays as it was.
  useEffect(() => {
    if (!editor) return
    let dom: HTMLElement
    try { dom = editor.view.dom } catch { return }
    const handler = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const markdown = selectionMarkdown(editor)
      const { from, to } = editor.state.selection
      const context: PluginContextActionContext = {
        target, path: documentPath ?? null, x: event.clientX, y: event.clientY,
        selectionText: from === to ? '' : editor.state.doc.textBetween(from, to, '\n'),
      }
      const actions = usePluginRegistry.getState().contextActions.filter(action => contextActionApplies(action, context))
      const isOrdered = editor.isActive('orderedList')
      if (!markdown && !actions.length && !isOrdered) return
      event.preventDefault()
      event.stopPropagation()

      const currentStart = isOrdered ? (Number(editor.getAttributes('orderedList').start) || 1) : 1
      const prevOrdered = isOrdered ? getPreviousOrderedList(editor.state) : null
      const listActions: EditorMenuItem[] = isOrdered ? [
        ...(currentStart !== 1 ? [{
          id: 'host.restart-numbering',
          label: t('toolbar.restartNumbering'),
          run: () => restartListNumbering(editor),
        }] : []),
        ...(prevOrdered ? [{
          id: 'host.continue-numbering',
          label: t('toolbar.continueNumbering'),
          run: () => continueListNumbering(editor),
        }] : []),
        {
          id: 'host.set-start-number',
          label: t('toolbar.setStartNumber'),
          run: () => setStartNumber(String(currentStart)),
        },
      ] : []

      const count = actions.length + listActions.length + (markdown ? 1 : 0)
      setMenu({
        markdown, actions, listActions, context,
        x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - (count * 34 + 12)),
      })
    }
    dom.addEventListener('contextmenu', handler, true)
    return () => dom.removeEventListener('contextmenu', handler, true)
  }, [editor, documentPath, t])

  useEffect(() => {
    if (!editor || !isFormatPainterArmed) return
    let dom: HTMLElement
    try { dom = editor.view.dom } catch { return }

    let pendingPaint: ReturnType<typeof setTimeout> | undefined
    const onPointerUp = (event: globalThis.MouseEvent) => {
      if (dom.contains(event.target as Node)) {
        clearTimeout(pendingPaint)
        pendingPaint = setTimeout(() => {
          pendingPaint = undefined
          if (!editor.isDestroyed && useFormatPainterStore.getState().armed) {
            useFormatPainterStore.getState().apply(editor)
          }
        }, 10)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        useFormatPainterStore.getState().disarm()
      }
    }

    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(pendingPaint)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [editor, isFormatPainterArmed])

  const menuItems = (current: NonNullable<typeof menu>): EditorMenuItem[] => [
    ...current.listActions,
    ...current.actions.map((action) => ({
      id: action.id, label: String(action.label), icon: action.icon,
      run: () => runContextAction(action, current.context),
    })),
    ...(current.markdown ? [{ id: 'host.save-snippet', label: 'Save Selection as Snippet...', run: () => setSnippetMarkdown(current.markdown) }] : []),
  ]

  return (
    <>
      <DocumentPathContext value={documentPath}><PageView editor={editor} onPageClick={focusWritingArea} onPagePointerDown={focusWritingArea}>
        <EditorContent editor={editor} className={`grimoire-content ${isFormatPainterArmed ? 'cursor-copy' : ''}`} />
      </PageView></DocumentPathContext>
      {menu && <EditorContextMenu x={menu.x} y={menu.y} onClose={closeMenu} items={menuItems(menu)} />}
      {snippetMarkdown !== null && <SaveSnippetDialog markdown={snippetMarkdown} onClose={() => setSnippetMarkdown(null)} />}
      {startNumber !== null && <ConfirmDialog title={t('toolbar.listStartNumber')}
        message={t('toolbar.promptStartNumber')} cancelLabel={t('common.cancel')} confirmLabel={t('common.save')}
        confirmDisabled={!/^\d+$/.test(startNumber.trim()) || !Number.isSafeInteger(Number(startNumber)) || Number(startNumber) < 1}
        onCancel={() => setStartNumber(null)} onConfirm={() => {
          if (editor) setListStart(editor, Number(startNumber))
          setStartNumber(null)
        }}>
        <input type="number" min="1" step="1" aria-label={t('toolbar.listStartNumber')}
          value={startNumber} onChange={event => setStartNumber(event.target.value)}
          className="mt-3 w-full rounded border border-white/20 bg-neutral-800 p-2 text-inherit" />
      </ConfirmDialog>}
    </>
  )
}
