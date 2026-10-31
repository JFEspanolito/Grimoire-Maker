import { useState } from 'react'
import { useWorkspaceRoot } from '@grimoire/plugin-api'
import { useQuotes } from './quotesStore'
import {
  CitationFormatter,
  type CitationStyle,
  type ReferenceItem,
} from './citationFormatter'
import {
  syncReferenceItem,
  handleInsertReferenceCitation,
} from './referencesManager'
import styles from './Quotes.module.css'

interface ReferenceCardProps {
  reference: ReferenceItem
  onUpdate: (updates: Partial<ReferenceItem>) => void
  onRemove: () => void
  onNotice: (msg: string) => void
  initiallyEditing?: boolean
}

export function ReferenceCard({
  reference,
  onUpdate,
  onRemove,
  onNotice,
  initiallyEditing = false,
}: ReferenceCardProps) {
  const root = useWorkspaceRoot()
  const [isEditing, setIsEditing] = useState(
    initiallyEditing || !reference.authors || !reference.title
  )

  const handleFieldChange = (updates: Partial<ReferenceItem>) => {
    onUpdate(updates)
    if (root) {
      const updated = { ...reference, ...updates }
      void syncReferenceItem(root, updated)
    }
  }

  const handleInsert = async () => {
    if (root) {
      await syncReferenceItem(root, reference)
    }
    const result = handleInsertReferenceCitation(reference, reference.style ?? 'APA')
    if (result.success && result.citationText) {
      onNotice(`Inserted citation ${result.citationText} at cursor`)
    } else {
      onNotice(result.message ?? 'Could not insert citation. Open a Draft document first.')
    }
  }

  const activeStyle = reference.style ?? 'APA'
  const inlinePreview = CitationFormatter.formatReferenceInline(reference, activeStyle)
  const biblioPreview = CitationFormatter.formatReferenceBibliography(reference, activeStyle)

  return (
    <li className={styles.card}>
      <div className={styles.quoteHeader}>
        <div className={styles.refInfoContainer}>
          <div className={styles.refInlinePreview}>
            <span className={styles.refPreviewLabel}>In-text citation:</span>
            <code className={styles.refInlineCode}>{inlinePreview}</code>
          </div>
          <div className={styles.refBiblioPreview}>
            <span className={styles.refPreviewLabel}>Bibliography:</span>
            <span className={styles.refBiblioText}>{biblioPreview}</span>
          </div>
        </div>
        <span className={styles.badge}>
          Ref [{reference.refIndex ?? 1}]
        </span>
      </div>

      {isEditing && (
        <div className={styles.refEditSection}>
          <div className={styles.metaGrid}>
            <label className={styles.field}>
              <span>AUTHORS</span>
              <input
                className={styles.input}
                value={reference.authors}
                placeholder="e.g. Fraústo da Silva, J. J. R. or Smith, J."
                onChange={(e) => handleFieldChange({ authors: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>YEAR</span>
              <input
                className={styles.input}
                value={reference.year}
                placeholder="e.g. 1991"
                onChange={(e) => handleFieldChange({ year: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>TITLE</span>
              <input
                className={styles.input}
                value={reference.title}
                placeholder="e.g. The biological chemistry of the elements"
                onChange={(e) => handleFieldChange({ title: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>VOLUME / ISSUE / PAGES</span>
              <input
                className={styles.input}
                value={reference.volumeIssuePages ?? ''}
                placeholder="e.g. Vol. 4, No. 2, pp. 45-52"
                onChange={(e) => handleFieldChange({ volumeIssuePages: e.target.value })}
              />
            </label>
          </div>

          <div className={styles.metaGridSecond}>
            <label className={styles.field}>
              <span>SOURCE / JOURNAL / PUBLISHER</span>
              <input
                className={styles.input}
                value={reference.sourceContainer}
                placeholder="e.g. Oxford University Press"
                onChange={(e) => handleFieldChange({ sourceContainer: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>DOI / URL</span>
              <input
                className={styles.input}
                value={reference.doiOrUrl ?? ''}
                placeholder="e.g. https://doi.org/10.1000/182"
                onChange={(e) => handleFieldChange({ doiOrUrl: e.target.value })}
              />
            </label>
          </div>
        </div>
      )}

      <div className={styles.cardFooter}>
        <div className={styles.actions}>
          <label className={styles.stylePicker} title="Citation Style">
            <span className={styles.styleLabel}>Style</span>
            <select
              className={styles.styleSelect}
              value={activeStyle}
              onChange={(e) => handleFieldChange({ style: e.target.value as CitationStyle })}
            >
              <option value="APA">APA (7th)</option>
              <option value="IEEE">IEEE (Numeric)</option>
              <option value="MLA">MLA (9th)</option>
              <option value="Chicago">Chicago (Notes)</option>
              <option value="Harvard">Harvard</option>
            </select>
          </label>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.editToggleBtn}
            onClick={() => setIsEditing((prev) => !prev)}
            title={isEditing ? 'Collapse metadata editor' : 'Edit reference metadata'}
          >
            {isEditing ? 'Done editing' : 'Edit metadata'}
          </button>
          <button
            type="button"
            className={styles.insertBtn}
            title="Insert citation at cursor and refocus editor"
            onClick={handleInsert}
          >
            Insert citation at cursor
          </button>
          <button
            type="button"
            className={styles.deleteBtn}
            title="Delete reference"
            onClick={onRemove}
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  )
}

export function ReferencesTab({
  onNotice,
}: {
  onNotice: (msg: string) => void
}) {
  const references = useQuotes((state) => state.references)
  const updateReference = useQuotes((state) => state.updateReference)
  const removeReference = useQuotes((state) => state.removeReference)

  if (references.length === 0) {
    return (
      <p className={styles.empty}>
        No references added yet. Click "+ New reference" above to add indirect citations / bibliographic references for paraphrasing.
      </p>
    )
  }

  return (
    <ul className={styles.list}>
      {references.map((ref) => (
        <ReferenceCard
          key={ref.id}
          reference={ref}
          onUpdate={(updates) => updateReference(ref.id, updates)}
          onRemove={() => removeReference(ref.id)}
          onNotice={onNotice}
        />
      ))}
    </ul>
  )
}
