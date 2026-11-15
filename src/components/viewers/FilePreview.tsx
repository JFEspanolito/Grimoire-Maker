import { getTranslation, useTranslation } from '../../lib/i18n'
import { useSettingsStore } from '../../stores/settingsStore'
import { reportError } from '../../lib/errorLogging'
import { lazy, Suspense, useEffect, useState } from 'react'
import { readFile, stat } from '@tauri-apps/plugin-fs'
import { classifyFile, fileExtension, IMAGE_MIME } from '../../lib/filePreview'
import { readDocx, type WordBlock, type WordParagraph } from '../../lib/docxPreview'
import styles from './FilePreview.module.css'

const PdfPreview = lazy(() => import('./PdfPreview').then((module) => ({ default: module.PdfPreview })))
const MAX_FILE_BYTES = 64 * 1024 * 1024

function Paragraph({ value }: { value: WordParagraph }) {
  return <p>{value.runs.length ? value.runs.map((run, index) => <span key={index} style={{
    fontWeight: run.bold ? 'bold' : undefined, fontStyle: run.italic ? 'italic' : undefined,
    textDecoration: run.underline ? 'underline' : undefined,
  }}>{run.text}</span>) : <br />}</p>
}

function WordPreview({ blocks }: { blocks: WordBlock[] }) {
  const { t } = useTranslation()
  return <>
    <p className={styles.notice}>{t('ui.read_only_content_preview_word_page_layout_and_embedded_objects_are_not_reproduc')}</p>
    <article className={styles.word} aria-label={t('ui.word_document_content')}>
      {blocks.map((block, index) => block.kind === 'paragraph' ? <Paragraph key={index} value={block} />
        : <table key={index}><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>
          {row.map((cell, cellIndex) => <td key={cellIndex}>{cell.map((value, pIndex) => <Paragraph key={pIndex} value={value} />)}</td>)}
        </tr>)}</tbody></table>)}
      {!blocks.length && <p>{t('ui.no_text_content_found')}</p>}
    </article>
  </>
}

function LoadedPreview({ path }: { path: string }) {
  const { t } = useTranslation()
  const kind = classifyFile(path)
  const extension = fileExtension(path)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [word, setWord] = useState<WordBlock[] | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actualSize, setActualSize] = useState(false)
  useEffect(() => {
    if (kind === 'unsupported' || kind === 'markdown' || extension === 'doc') return
    let cancelled = false
    let url: string | null = null
    void (async () => {
      const info = await stat(path)
      if (cancelled) return
      if (info.size > MAX_FILE_BYTES) throw new Error(getTranslation('ui.this_file_is_too_large_to_preview_64_mb_maximum', useSettingsStore.getState().language))
      const data = await readFile(path)
      if (cancelled) return
      if (data.byteLength > MAX_FILE_BYTES) throw new Error(getTranslation('ui.this_file_is_too_large_to_preview_64_mb_maximum', useSettingsStore.getState().language))
      if (kind === 'image') {
        url = URL.createObjectURL(new Blob([new Uint8Array(data).buffer], { type: IMAGE_MIME[extension] }))
        setImageUrl(url)
      } else if (kind === 'word') setWord(readDocx(data))
      else if (kind === 'text') setText(new TextDecoder('utf-8').decode(data))
      else setBytes(data)
    })().catch((failure: unknown) => {
      if (!cancelled) { reportError('preview.file', failure); setError(failure instanceof Error ? failure.message : String(failure)) }
    })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [path, kind, extension])

  return <div className={styles.preview} aria-label={t('ui.read_only_file_preview')}>
    <header className={styles.header}><span title={path}>{path.replaceAll('\\', '/').split('/').at(-1)}</span><span>{t('ui.read_only')}</span></header>
    {error ? <p className={styles.notice} role="alert">{t('ui.previewFailed', { error })}</p>
      : extension === 'doc' ? <p className={styles.notice}>{t('ui.legacy_doc_files_cannot_be_previewed_save_the_document_as_docx_in_word_or_libreo')}</p>
        : kind === 'unsupported' || kind === 'markdown' ? <p className={styles.notice}>{t('ui.no_preview_is_available_for_this_file_type')}</p>
          : imageUrl ? <>
            <div className={styles.controls}><button type="button" onClick={() => setActualSize(!actualSize)}>{actualSize ? t('ui.fit_image') : t('ui.actual_size')}</button></div>
            <div className={styles.imageArea}><img className={actualSize ? styles.actualImage : styles.fitImage} src={imageUrl}
              alt={path.replaceAll('\\', '/').split('/').at(-1)} onError={() => { const message = t('ui.the_image_is_damaged_or_its_format_is_not_supported_by_this_system'); reportError('preview.image', message); setError(message) }} /></div>
          </>
            : word ? <WordPreview blocks={word} />
              : text !== null ? <pre className={styles.text} aria-label={t('ui.text_file_content')}>{text}</pre>
                : bytes ? <Suspense fallback={<p role="status">{t('ui.loading_pdf_viewer')}</p>}><PdfPreview bytes={bytes} /></Suspense>
                  : <p className={styles.notice} role="status">{t('ui.loading_preview')}</p>}
  </div>
}

export function FilePreview({ path }: { path: string }) {
  // Key the complete loading lifecycle, including late reads and object URL cleanup.
  return <LoadedPreview key={path} path={path} />
}
