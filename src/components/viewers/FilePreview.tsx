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
  return <>
    <p className={styles.notice}>Read-only content preview. Word page layout and embedded objects are not reproduced.</p>
    <article className={styles.word} aria-label="Word document content">
      {blocks.map((block, index) => block.kind === 'paragraph' ? <Paragraph key={index} value={block} />
        : <table key={index}><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>
          {row.map((cell, cellIndex) => <td key={cellIndex}>{cell.map((value, pIndex) => <Paragraph key={pIndex} value={value} />)}</td>)}
        </tr>)}</tbody></table>)}
      {!blocks.length && <p>No text content found.</p>}
    </article>
  </>
}

function LoadedPreview({ path }: { path: string }) {
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
      if (info.size > MAX_FILE_BYTES) throw new Error('This file is too large to preview (64 MB maximum).')
      const data = await readFile(path)
      if (cancelled) return
      if (data.byteLength > MAX_FILE_BYTES) throw new Error('This file is too large to preview (64 MB maximum).')
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

  return <div className={styles.preview} aria-label="Read-only file preview">
    <header className={styles.header}><span title={path}>{path.replaceAll('\\', '/').split('/').at(-1)}</span><span>Read-only</span></header>
    {error ? <p className={styles.notice} role="alert">Could not preview file: {error}</p>
      : extension === 'doc' ? <p className={styles.notice}>Legacy .doc files cannot be previewed. Save the document as DOCX in Word or LibreOffice, then open that file here.</p>
        : kind === 'unsupported' || kind === 'markdown' ? <p className={styles.notice}>No preview is available for this file type.</p>
          : imageUrl ? <>
            <div className={styles.controls}><button type="button" onClick={() => setActualSize(!actualSize)}>{actualSize ? 'Fit image' : 'Actual size'}</button></div>
            <div className={styles.imageArea}><img className={actualSize ? styles.actualImage : styles.fitImage} src={imageUrl}
              alt={path.replaceAll('\\', '/').split('/').at(-1)} onError={() => { const message = 'The image is damaged or its format is not supported by this system.'; reportError('preview.image', message); setError(message) }} /></div>
          </>
            : word ? <WordPreview blocks={word} />
              : text !== null ? <pre className={styles.text} aria-label="Text file content">{text}</pre>
                : bytes ? <Suspense fallback={<p role="status">Loading PDF viewer…</p>}><PdfPreview bytes={bytes} /></Suspense>
                  : <p className={styles.notice} role="status">Loading preview…</p>}
  </div>
}

export function FilePreview({ path }: { path: string }) {
  // Key the complete loading lifecycle, including late reads and object URL cleanup.
  return <LoadedPreview key={path} path={path} />
}
