import { useEffect, useRef, useState } from 'react'
import type { Template } from '../../lib/templates'
import { PAGE_SIZES, type FileNode, type Frontmatter, type PageSizeId } from '../../types/document'
import { parseDocument } from '../../lib/frontmatter'
import { renderDocumentHtml } from '../editor/renderDocumentContent'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { useTranslation } from '../../lib/i18n'
import styles from './TemplatePreviewModal.module.css'

interface Props {
  template: Template
  templates: Template[]
  hasProject: boolean
  onClose: () => void
  onApply: (template: Template, replaceExisting: boolean) => void
}

async function collectTemplateTree(template: Template): Promise<FileNode[]> {
  if (template.location?.kind === 'package') {
    try {
      async function walk(dir: string, prefix: string): Promise<FileNode[]> {
        const entries = await readDir(dir)
        const nodes: FileNode[] = []
        const sorted = entries
          .filter((e) => !e.name.startsWith('.') && !e.isSymlink)
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
            return a.name.localeCompare(b.name)
          })

        for (const entry of sorted) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory) {
            const children = await walk(`${dir}/${entry.name}`, rel)
            nodes.push({
              name: entry.name,
              path: rel,
              isDirectory: true,
              children,
            })
          } else {
            nodes.push({
              name: entry.name,
              path: rel,
              isDirectory: false,
            })
          }
        }
        return nodes
      }

      const result = await walk(template.location.path, '')
      if (result.length > 0) {
        return result.sort((a, b) => {
          if (a.path === 'index.md') return -1
          if (b.path === 'index.md') return 1
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      }
    } catch {
      // Fallback
    }
  }
  return [{ name: 'index.md', path: 'index.md', isDirectory: false }]
}

function countFiles(nodes: FileNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.isDirectory) {
      count += countFiles(node.children ?? [])
    } else {
      count++
    }
  }
  return count
}

function TemplateTreeItem({
  node,
  depth,
  selectedFile,
  collapsed,
  onToggle,
  onSelectFile,
}: {
  node: FileNode
  depth: number
  selectedFile: string
  collapsed: Set<string>
  onToggle: (path: string) => void
  onSelectFile: (path: string) => void
}) {
  const isDir = node.isDirectory
  const isCollapsed = collapsed.has(node.path)

  if (isDir) {
    return (
      <li>
        <button
          type="button"
          className={styles.fileItem}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          aria-expanded={!isCollapsed}
          onClick={() => onToggle(node.path)}
        >
          <span className={styles.folderArrow} aria-hidden="true">{isCollapsed ? '▶' : '▼'}</span>
          <span aria-hidden="true">📁</span>
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {!isCollapsed && node.children && node.children.length > 0 && (
          <ul className={styles.subTree}>
            {node.children.map((child) => (
              <TemplateTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const isSelected = selectedFile === node.path
  return (
    <li>
      <button
        type="button"
        className={`${styles.fileItem} ${isSelected ? styles.fileItemActive : ''}`}
        style={{ paddingLeft: `${depth * 14 + 24}px` }}
        onClick={() => onSelectFile(node.path)}
      >
        <span aria-hidden="true">{node.name.endsWith('.md') ? '📄' : '📎'}</span>
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  )
}

export function TemplatePreviewModal({ template, templates, hasProject, onClose, onApply }: Props) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const [currentTemplate, setCurrentTemplate] = useState<Template>(template)
  const [tree, setTree] = useState<FileNode[]>([{ name: 'index.md', path: 'index.md', isDirectory: false }])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string>('index.md')
  const [previewContent, setPreviewContent] = useState<{ frontmatter: Frontmatter; body: string }>({
    frontmatter: template.frontmatter,
    body: template.body,
  })
  const [renderedHtml, setRenderedHtml] = useState<string>('')

  useEffect(() => {
    const el = dialog.current
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    el?.showModal()
    return () => {
      el?.close()
      if (prev?.isConnected) prev.focus()
    }
  }, [])

  // When switching currentTemplate
  useEffect(() => {
    let cancelled = false
    setSelectedFile('index.md')
    setCollapsed(new Set())
    setPreviewContent({
      frontmatter: currentTemplate.frontmatter,
      body: currentTemplate.body,
    })
    void collectTemplateTree(currentTemplate).then((nodes) => {
      if (!cancelled) setTree(nodes)
    })
    return () => { cancelled = true }
  }, [currentTemplate])

  // When changing selectedFile
  useEffect(() => {
    if (selectedFile === 'index.md') {
      setPreviewContent({
        frontmatter: currentTemplate.frontmatter,
        body: currentTemplate.body,
      })
      return
    }

    if (currentTemplate.location?.kind === 'package' && /\.md$/i.test(selectedFile)) {
      let cancelled = false
      void readTextFile(`${currentTemplate.location.path}/${selectedFile}`)
        .then((text) => {
          if (cancelled) return
          const parsed = parseDocument(text)
          setPreviewContent({
            frontmatter: { ...currentTemplate.frontmatter, ...parsed.frontmatter },
            body: parsed.body,
          })
        })
        .catch(() => {
          if (!cancelled) {
            setPreviewContent({
              frontmatter: currentTemplate.frontmatter,
              body: currentTemplate.body,
            })
          }
        })
      return () => { cancelled = true }
    }
  }, [selectedFile, currentTemplate])

  // Render markdown body to HTML for preview
  useEffect(() => {
    let cancelled = false
    void renderDocumentHtml(previewContent.body, null)
      .then((html) => {
        if (!cancelled) setRenderedHtml(html)
      })
      .catch(() => {
        if (!cancelled) setRenderedHtml('')
      })
    return () => { cancelled = true }
  }, [previewContent.body])

  const pageSizeId = (previewContent.frontmatter.pageSize ?? 'a4') as PageSizeId
  const pageSize = PAGE_SIZES[pageSizeId] ?? PAGE_SIZES.a4
  const columns = previewContent.frontmatter.columns ?? 1
  const theme = previewContent.frontmatter.theme ?? 'parchment'

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="template-preview-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <h2 id="template-preview-title">{`Template: ${currentTemplate.label}`}</h2>
          <select
            aria-label="Select template"
            className={styles.templateSelect}
            value={currentTemplate.id}
            onChange={(e) => {
              const next = templates.find((t) => t.id === e.target.value)
              if (next) setCurrentTemplate(next)
            }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={styles.closeButton} aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.leftPanel}>
          <div className={styles.panelTitle}>Files ({countFiles(tree)})</div>
          <ul className={styles.fileList}>
            {tree.map((node) => (
              <TemplateTreeItem
                key={node.path}
                node={node}
                depth={0}
                selectedFile={selectedFile}
                collapsed={collapsed}
                onToggle={(path) => {
                  setCollapsed((prev) => {
                    const next = new Set(prev)
                    if (next.has(path)) next.delete(path)
                    else next.add(path)
                    return next
                  })
                }}
                onSelectFile={setSelectedFile}
              />
            ))}
          </ul>
        </div>

        <div className={styles.rightPanel}>
          <div className={styles.previewMeta}>
            <span className="font-medium text-white/80 truncate">{selectedFile}</span>
            <div className={styles.previewMetaBadges}>
              <span className={styles.previewMetaBadge}>{pageSize.label}</span>
              <span className={styles.previewMetaBadge}>{columns} {columns === 1 ? 'column' : 'columns'}</span>
              <span className={styles.previewMetaBadge}>{theme}</span>
            </div>
          </div>
          <div className={styles.previewViewport}>
            <div
              className={`grimoire-page grimoire-content ${styles.pageContainer}`}
              data-theme={theme}
              style={{
                width: `${pageSize.widthMm}mm`,
                minHeight: `${pageSize.heightMm}mm`,
                padding: '16mm 14mm',
                columnCount: columns,
                transform: 'scale(0.65)',
              }}
            >
              {renderedHtml ? (
                <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
              ) : (
                <pre className={styles.fallbackContent}>{previewContent.body}</pre>
              )}
            </div>
          </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <p className={styles.footerHint}>
          {hasProject
            ? 'Añadir conserva los documentos actuales. Reemplazar mueve todo Draft a Trash antes de aplicar la plantilla.'
            : 'No hay un proyecto abierto. Elige una carpeta donde crear el proyecto para aplicar esta plantilla.'}
        </p>
        <div className={styles.footerActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => onApply(currentTemplate, false)}
          >
            {hasProject ? 'Añadir esto al proyecto actual' : 'Elegir carpeta y crear proyecto'}
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            disabled={!hasProject}
            onClick={() => onApply(currentTemplate, true)}
          >
            Reemplazar existente
          </button>
        </div>
      </footer>
    </dialog>
  )
}
