import { getTranslation, type TranslationKey } from '../../../lib/i18n'
import { useSettingsStore } from '../../../stores/settingsStore'
import { Node, mergeAttributes } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import katex from 'katex'
import { useFormulaStore, type FormulaDisplay } from '../../../stores/formulaStore'

const t = (key: TranslationKey, values?: Record<string, string>) => getTranslation(key, useSettingsStore.getState().language, values)

export interface FormulaValidation {
  html: string
  error: string | null
}

/** Renders LaTeX to KaTeX HTML + MathML and reports syntax errors for the live preview dialog. */
export function validateAndRenderFormula(latex: string, display: FormulaDisplay): FormulaValidation {
  const source = latex.trim()
  if (!source) return { html: '', error: t('ui.enter_a_latex_expression_to_preview_and_insert') }
  try {
    const html = katex.renderToString(source, {
      displayMode: display === 'block',
      throwOnError: true,
      output: 'htmlAndMathml',
      strict: false,
    })
    return { html, error: null }
  } catch (error) {
    const fallback = katex.renderToString(source, {
      displayMode: display === 'block',
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: false,
    })
    const message = error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/i, '') : String(error)
    return { html: fallback, error: message }
  }
}

export function renderFormulaHtml(latex: string, display: FormulaDisplay): string {
  const source = latex.trim() || '\\text{?}'
  return katex.renderToString(source, {
    displayMode: display === 'block',
    throwOnError: false,
    output: 'htmlAndMathml',
    strict: false,
  })
}

const escapeAttr = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r\n', '&#10;')
    .replaceAll('\n', '&#10;')

interface MarkdownState {
  write(text: string): void
}

/**
 * Inline/block mathematical formula rendered with KaTeX and stored in Markdown as a self-contained
 * `<span data-type="math-formula" data-latex="..." data-display="block|inline"></span>` tag.
 */
export const MathFormula = Node.create({
  name: 'mathFormula',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') ?? '',
      },
      display: {
        default: 'block',
        parseHTML: (element: HTMLElement): FormulaDisplay =>
          element.getAttribute('data-display') === 'inline' ? 'inline' : 'block',
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math-formula"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const latex = String(node.attrs.latex ?? '')
    const display: FormulaDisplay = node.attrs.display === 'inline' ? 'inline' : 'block'
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'math-formula',
        'data-latex': latex,
        'data-display': display,
        class: 'grimoire-formula',
      }),
    ]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span')
      dom.setAttribute('data-type', 'math-formula')
      dom.setAttribute('contenteditable', 'false')
      dom.className = 'grimoire-formula'

      const sync = (current: PMNode) => {
        const latex = String(current.attrs.latex ?? '')
        const display: FormulaDisplay = current.attrs.display === 'inline' ? 'inline' : 'block'
        dom.setAttribute('data-latex', latex)
        dom.setAttribute('data-display', display)
        dom.title = t('ui.formula.title', { display: t(display === 'inline' ? 'ui.formula.inline' : 'ui.formula.block'), latex })
        dom.innerHTML = renderFormulaHtml(latex, display)
      }

      sync(node)

      let currentNode = node
      const unsubscribe = useSettingsStore.subscribe((state, previous) => { if (state.language !== previous.language) sync(currentNode) })
      dom.addEventListener('dblclick', (event) => {
        if (!editor.isEditable) return
        event.preventDefault()
        event.stopPropagation()
        const pos = typeof getPos === 'function' ? getPos() : null
        useFormulaStore.getState().show(editor, {
          latex: String(currentNode.attrs.latex ?? ''),
          display: currentNode.attrs.display === 'inline' ? 'inline' : 'block',
          editPos: typeof pos === 'number' ? pos : null,
        })
      })

      return {
        dom,
        destroy: unsubscribe,
        update(next) {
          if (next.type !== currentNode.type) return false
          currentNode = next
          sync(next)
          return true
        },
        selectNode() {
          dom.setAttribute('data-selected', 'true')
        },
        deselectNode() {
          dom.removeAttribute('data-selected')
        },
      }
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode) {
          const latex = escapeAttr(String(node.attrs.latex ?? ''))
          const display: FormulaDisplay = node.attrs.display === 'inline' ? 'inline' : 'block'
          state.write(`<span data-type="math-formula" data-latex="${latex}" data-display="${display}"></span>`)
        },
        parse: {},
      },
    }
  },
})
