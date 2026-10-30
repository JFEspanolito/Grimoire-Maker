import { useEffect, useRef, useState } from 'react'
import { useWorkspaceRoot } from '@grimoire/plugin-api'
import { useQuotes, type Quote } from './quotesStore'
import type { CitationStyle } from './citationFormatter'
import { syncReferences, insertQuote, ensureReferenceForQuote } from './referencesManager'
import { findSnippetDropTarget, getActiveSnippetDropTarget } from '../../../../lib/snippetDrop'
import { insertContentBox } from '../../../../lib/contentBoxes'
import styles from './Quotes.module.css'

function QuoteCard({
  quote,
  onUpdate,
  onRemove,
  onInsert,
}: {
  quote: Quote
  onUpdate: (updates: Partial<Quote>) => void
  onRemove: () => void
  onInsert: () => void
}) {
  const root = useWorkspaceRoot()

  const handleUpdate = (updates: Partial<Quote>) => {
    onUpdate(updates)
    if (root) {
      const updated = { ...quote, ...updates }
      void syncReferences(root, updated)
    }
  }

  const handleDragStart = (e: React.DragEvent) => {
    const textRef = insertQuote(quote, quote.quoteType)
    e.dataTransfer.setData('text/plain', textRef)
    e.dataTransfer.setData('application/x-grimoire-quote', quote.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragEnd = async (e: React.DragEvent) => {
    if (!root) return
    const drop = findSnippetDropTarget(e.clientX, e.clientY)
    if (drop) {
      const { refIndex } = await syncReferences(root, quote)
      const updated = { ...quote, refIndex }
      const textRef = insertQuote(updated, quote.quoteType)
      insertContentBox(drop.editor, textRef, drop.position)
    }
  }

  const textValue = quote.quoteText || quote.text || ''
  const isNumeric = quote.quoteType === 'IEEE' || quote.quoteType === 'Chicago'

  return (
    <li className={styles.card}>
      <div className={styles.quoteHeader}>
        <textarea
          className={styles.quoteInput}
          value={textValue}
          placeholder="Quote text…"
          rows={Math.max(2, Math.min(6, (textValue.match(/\n/g) || []).length + 1))}
          onChange={(e) => handleUpdate({ quoteText: e.target.value, text: e.target.value })}
        />
        <span className={styles.badge}>
          {isNumeric
            ? (quote.refIndex ?? quote.referenceNumber ? `Ref [${quote.refIndex ?? quote.referenceNumber}]` : 'Unassigned')
            : (quote.quoteType ?? 'APA')}
        </span>
      </div>

      <div className={styles.metaGrid}>
        <label className={styles.field}>
          <span>Author Last Name</span>
          <input
            className={styles.input}
            value={quote.authorLastName}
            placeholder="e.g. Smith"
            onChange={(e) => handleUpdate({ authorLastName: e.target.value, author: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Initial</span>
          <input
            className={styles.input}
            value={quote.authorInitial ?? ''}
            placeholder="e.g. J."
            onChange={(e) => handleUpdate({ authorInitial: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Year</span>
          <input
            className={styles.input}
            value={quote.year}
            placeholder="e.g. 2026"
            onChange={(e) => handleUpdate({ year: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Page</span>
          <input
            className={styles.input}
            value={quote.page}
            placeholder="e.g. 2 or 15-16"
            onChange={(e) => handleUpdate({ page: e.target.value })}
          />
        </label>
      </div>

      <div className={styles.metaGridSecond}>
        <label className={styles.field}>
          <span>Title</span>
          <input
            className={styles.input}
            value={quote.title}
            placeholder="e.g. Data Management Guidelines"
            onChange={(e) => handleUpdate({ title: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Source / Publisher</span>
          <input
            className={styles.input}
            value={quote.sourceContainer ?? ''}
            placeholder="e.g. Tech Press / Journal"
            onChange={(e) => handleUpdate({ sourceContainer: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>DOI / URL</span>
          <input
            className={styles.input}
            value={quote.doiOrUrl ?? ''}
            placeholder="e.g. https://doi.org/10..."
            onChange={(e) => handleUpdate({ doiOrUrl: e.target.value })}
          />
        </label>
      </div>

      <div className={styles.cardFooter}>
        <div
          className={styles.dragHandle}
          draggable
          title="Drag this quote into your draft"
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          ⋮⋮ Drag to insert
        </div>
        <div className={styles.actions}>
          <label className={styles.stylePicker} title="Citation Style">
            <span className={styles.styleLabel}>Quote Type</span>
            <select
              className={styles.styleSelect}
              value={quote.quoteType ?? 'APA'}
              onChange={(e) => handleUpdate({ quoteType: e.target.value as CitationStyle })}
            >
              <option value="APA">APA (7th)</option>
              <option value="IEEE">IEEE (Numeric)</option>
              <option value="MLA">MLA (9th)</option>
              <option value="Chicago">Chicago (Notes)</option>
              <option value="Harvard">Harvard</option>
            </select>
          </label>
          <button type="button" className={styles.insertBtn} title="Insert at cursor" onClick={onInsert}>
            Insert at cursor
          </button>
          <button type="button" className={styles.deleteBtn} title="Delete quote" onClick={onRemove}>
            Delete
          </button>
        </div>
      </div>
    </li>
  )
}

function QuotesDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const root = useWorkspaceRoot()
  const { items, error, add, update, remove } = useQuotes()
  const [activeTab, setActiveTab] = useState<'quotes' | 'references'>('quotes')
  const [notice, setNotice] = useState<string | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const isDraggingHeader = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })

  useEffect(() => {
    const el = dialog.current
    if (el && !el.open) {
      if (typeof el.show === 'function') el.show()
      else el.showModal()
    }
    return () => el?.close()
  }, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, [role="tab"]')) return
    isDraggingHeader.current = true
    const rect = dialog.current?.getBoundingClientRect()
    const currentX = rect?.left ?? Math.max(20, window.innerWidth - 1100)
    const currentY = rect?.top ?? 70
    dragStart.current = { x: e.clientX, y: e.clientY, posX: currentX, posY: currentY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingHeader.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    const newX = Math.max(10, Math.min(window.innerWidth - 300, dragStart.current.posX + dx))
    const newY = Math.max(10, Math.min(window.innerHeight - 150, dragStart.current.posY + dy))
    setPosition({ x: newX, y: newY })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingHeader.current = false
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!root) return
    for (const item of items) {
      const isNumeric = item.quoteType === 'IEEE' || item.quoteType === 'Chicago'
      if (isNumeric && !item.refIndex && !item.referenceNumber) {
        void syncReferences(root, item)
      }
    }
  }, [root, items])

  const handleCreateQuote = () => {
    const newQuote = add({
      quoteText: '',
      authorLastName: '',
      authorInitial: '',
      year: new Date().getFullYear().toString(),
      page: '',
      title: '',
      sourceContainer: '',
      doiOrUrl: '',
      quoteType: 'APA',
    })
    if (newQuote && root) {
      void syncReferences(root, newQuote)
    }
  }

  const handleInsertAtCursor = async (quote: Quote) => {
    if (!root) return
    const active = getActiveSnippetDropTarget()
    if (!active) {
      setNotice('Open a Draft document to insert the quote.')
      return
    }
    const { refIndex } = await syncReferences(root, quote)
    const updated = { ...quote, refIndex }
    const quoteMarkdown = insertQuote(updated, quote.quoteType)
    insertContentBox(active.editor, quoteMarkdown)
    const isNumeric = quote.quoteType === 'IEEE' || quote.quoteType === 'Chicago'
    const refNotice = isNumeric ? ` with reference [${refIndex}]` : ` (${quote.quoteType ?? 'APA'})`
    setNotice(`Inserted quote${refNotice} into ${active.documentPath ?? 'document'}`)
    setTimeout(() => setNotice(null), 3000)
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="quotes-title"
      style={position ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto', margin: 0 } : undefined}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <header
        className={styles.header}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className={styles.headerTitleRow}>
          <h2 id="quotes-title">Quotes & Citations</h2>
          {activeTab === 'quotes' && (
            <button
              type="button"
              className={styles.newQuoteBtn}
              title="Create a new quote manually"
              onClick={handleCreateQuote}
            >
              + New quote
            </button>
          )}
        </div>
        <button type="button" className={styles.close} aria-label="Close Quotes" onClick={onClose}>
          ×
        </button>
      </header>

      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'quotes'}
          className={`${styles.tabButton} ${activeTab === 'quotes' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('quotes')}
        >
          Quotes ({items.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'references'}
          className={`${styles.tabButton} ${activeTab === 'references' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('references')}
        >
          References
        </button>
      </div>

      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}

      {activeTab === 'quotes' ? (
        items.length === 0 ? (
          <p className={styles.empty}>
            No quotes collected yet. Select text in any Draft or Research document, right-click, and choose "Add to quote", or click "+ New quote" above.
          </p>
        ) : (
          <ul className={styles.list}>
            {items.map((quote) => (
              <QuoteCard
                key={quote.id}
                quote={quote}
                onUpdate={(updates) => update(quote.id, updates)}
                onRemove={() => remove(quote.id)}
                onInsert={() => void handleInsertAtCursor(quote)}
              />
            ))}
          </ul>
        )
      ) : (
        <div className={styles.placeholderView}>
          <p className={styles.empty}>
            References view (coming soon).
          </p>
        </div>
      )}
    </dialog>
  )
}

export function QuotesButton() {
  const root = useWorkspaceRoot()
  const load = useQuotes((state) => state.load)
  const count = useQuotes((state) => state.items.length)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (root) void load(root)
  }, [root, load])

  return (
    <>
      <button
        type="button"
        className={styles.button}
        disabled={!root}
        title="Quotes and citations of this project"
        onClick={() => setShown((prev) => !prev)}
      >
        Quotes <span className={styles.count}>{count}</span>
      </button>
      {shown && <QuotesDialog onClose={() => setShown(false)} />}
    </>
  )
}
