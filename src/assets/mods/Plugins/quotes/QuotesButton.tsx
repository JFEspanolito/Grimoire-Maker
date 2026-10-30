import { useEffect, useRef, useState } from 'react'
import { useWorkspaceRoot } from '@grimoire/plugin-api'
import { useQuotes, type Quote, type QuoteType } from './quotesStore'
import { ensureReferenceForQuote, formatQuoteMarkdown } from './referencesManager'
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
      void ensureReferenceForQuote(root, updated)
    }
  }

  const handleDragStart = (e: React.DragEvent) => {
    const textRef = formatQuoteMarkdown(quote, quote.referenceNumber ?? 1)
    e.dataTransfer.setData('text/plain', textRef)
    e.dataTransfer.setData('application/x-grimoire-quote', quote.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragEnd = async (e: React.DragEvent) => {
    if (!root) return
    const drop = findSnippetDropTarget(e.clientX, e.clientY)
    if (drop) {
      const { referenceNumber, quoteMarkdown } = await ensureReferenceForQuote(root, quote)
      insertContentBox(drop.editor, quoteMarkdown, drop.position)
    }
  }

  return (
    <li className={styles.card}>
      <div className={styles.quoteHeader}>
        <textarea
          className={styles.quoteInput}
          value={quote.text}
          placeholder="Quote text…"
          rows={Math.max(2, Math.min(6, (quote.text.match(/\n/g) || []).length + 1))}
          onChange={(e) => handleUpdate({ text: e.target.value })}
        />
        <span className={styles.badge}>
          {quote.referenceNumber ? `Ref [${quote.referenceNumber}]` : 'Unassigned'}
        </span>
      </div>

      <div className={styles.metaGrid}>
        <label className={styles.field}>
          <span>Author</span>
          <input
            className={styles.input}
            value={quote.author}
            placeholder="e.g. Smith, J."
            onChange={(e) => handleUpdate({ author: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Year</span>
          <input
            className={styles.input}
            value={quote.year}
            placeholder="e.g. 2024"
            onChange={(e) => handleUpdate({ year: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Page</span>
          <input
            className={styles.input}
            value={quote.page}
            placeholder="e.g. 42"
            onChange={(e) => handleUpdate({ page: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Source / Title</span>
          <input
            className={styles.input}
            value={quote.title}
            placeholder="e.g. Journal of AI"
            onChange={(e) => handleUpdate({ title: e.target.value })}
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
              onChange={(e) => handleUpdate({ quoteType: e.target.value as QuoteType })}
            >
              <option value="APA">APA</option>
              <option value="Chicago">Chicago</option>
              <option value="MLA">MLA</option>
              <option value="Harvard">Harvard</option>
              <option value="IEEE">IEEE</option>
              <option value="ASC">ASC</option>
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

  const handleCreateQuote = () => {
    const newQuote = add({
      text: '',
      author: '',
      year: new Date().getFullYear().toString(),
      page: '',
      title: '',
      quoteType: 'APA',
    })
    if (newQuote && root) {
      void ensureReferenceForQuote(root, newQuote)
    }
  }
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const el = dialog.current
    el?.showModal()
    return () => el?.close()
  }, [])

  useEffect(() => {
    if (!root) return
    for (const item of items) {
      if (!item.referenceNumber) {
        void ensureReferenceForQuote(root, item)
      }
    }
  }, [root, items])

  const handleInsertAtCursor = async (quote: Quote) => {
    if (!root) return
    const active = getActiveSnippetDropTarget()
    if (!active) {
      setNotice('Open a Draft document to insert the quote.')
      return
    }
    const { referenceNumber, quoteMarkdown } = await ensureReferenceForQuote(root, quote)
    insertContentBox(active.editor, quoteMarkdown)
    setNotice(`Inserted quote with reference [${referenceNumber}] into ${active.documentPath ?? 'document'}`)
    setTimeout(() => setNotice(null), 3000)
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="quotes-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <header className={styles.header}>
        <div className={styles.headerTitleRow}>
          <h2 id="quotes-title">Quotes & Citations</h2>
          <button
            type="button"
            className={styles.newQuoteBtn}
            title="Create a new quote manually"
            onClick={handleCreateQuote}
          >
            + New quote
          </button>
        </div>
        <button type="button" className={styles.close} aria-label="Close Quotes" onClick={onClose}>
          ×
        </button>
      </header>

      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}

      {items.length === 0 ? (
        <p className={styles.empty}>
          No quotes collected yet. Select text in any Draft or Research document, right-click, and choose "Add to quote".
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
        onClick={() => setShown(true)}
      >
        Quotes <span className={styles.count}>{count}</span>
      </button>
      {shown && <QuotesDialog onClose={() => setShown(false)} />}
    </>
  )
}
