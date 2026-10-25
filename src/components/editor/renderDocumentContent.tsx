import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from './editorExtensions'
import { DocumentPathContext } from './DocumentPathContext'

const SETTLE_TIMEOUT_MS = 15000

function Page({ markdown }: { markdown: string }) {
  const editor = useEditor({ extensions: EDITOR_EXTENSIONS, content: markdown, editable: false })
  return <EditorContent editor={editor} className="grimoire-content" />
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error ?? new Error('Could not read an image for the book.'))
  reader.readAsDataURL(blob)
})

/** Images load asynchronously through blob URLs; the HTML is only complete once they have. */
async function settled(host: HTMLElement) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  const ready = () => {
    const editor = host.querySelector('.ProseMirror')
    if (!editor || /Loading image…/.test(editor.textContent ?? '')) return false
    return Array.from(editor.querySelectorAll('img')).every((image) => image.complete)
  }
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Images took too long to load while preparing the book.')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/**
 * Renders a Markdown document with the page editor's own node views and returns its HTML.
 * Images are inlined, so the result stays valid after the temporary editor releases its blob URLs.
 */
export async function renderDocumentHtml(markdown: string, path: string | null): Promise<string> {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:800px;visibility:hidden;pointer-events:none'
  document.body.append(host)
  const root = createRoot(host)
  try {
    root.render(<DocumentPathContext value={path}><Page markdown={markdown} /></DocumentPathContext>)
    await settled(host)
    const editor = host.querySelector('.ProseMirror')!
    await Promise.all(Array.from(editor.querySelectorAll('img')).filter((image) => image.src.startsWith('blob:')).map(async (image) => {
      image.src = await blobToDataUrl(await (await fetch(image.src)).blob())
    }))
    return editor.innerHTML
  } finally {
    root.unmount()
    host.remove()
  }
}
