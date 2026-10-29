import { useEffect, useRef, useState } from 'react'
import { applyFormula } from '../../lib/insertActions'
import { useFormulaStore, type FormulaDisplay } from '../../stores/formulaStore'
import { validateAndRenderFormula } from './extensions/formula'
import styles from './FormulaDialog.module.css'
import { useTranslation } from '../../lib/i18n'

interface Preset {
  label: string
  latex: string
}

const PRESETS: Preset[] = [
  { label: 'Fraction', latex: '\\frac{a}{b}' },
  { label: 'Square Root', latex: '\\sqrt{x}' },
  { label: 'N-th Root', latex: '\\sqrt[n]{x}' },
  { label: 'Power / Sub', latex: 'x_{i}^{2}' },
  { label: 'Integral', latex: '\\int_{a}^{b} f(x)\\,dx' },
  { label: 'Summation', latex: '\\sum_{n=1}^{\\infty} a_n' },
  { label: 'Product', latex: '\\prod_{i=1}^{n} x_i' },
  { label: 'Limit', latex: '\\lim_{x \\to \\infty} f(x)' },
  { label: 'Derivative', latex: '\\frac{df}{dx}' },
  { label: 'Partial', latex: '\\frac{\\partial f}{\\partial x}' },
  { label: 'Matrix 2×2', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { label: 'Piecewise', latex: '\\begin{cases} x, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}' },
  { label: 'Binomial', latex: '\\binom{n}{k}' },
  { label: 'Quadratic', latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
]

const SYMBOLS: Preset[] = [
  { label: '±', latex: '\\pm ' },
  { label: '×', latex: '\\times ' },
  { label: '÷', latex: '\\div ' },
  { label: '≠', latex: '\\neq ' },
  { label: '≤', latex: '\\le ' },
  { label: '≥', latex: '\\ge ' },
  { label: '≈', latex: '\\approx ' },
  { label: '∞', latex: '\\infty ' },
  { label: '∂', latex: '\\partial ' },
  { label: '∇', latex: '\\nabla ' },
  { label: '∈', latex: '\\in ' },
  { label: '⊂', latex: '\\subset ' },
  { label: '∪', latex: '\\cup ' },
  { label: '∩', latex: '\\cap ' },
  { label: '⇒', latex: '\\Rightarrow ' },
  { label: '⇔', latex: '\\Leftrightarrow ' },
  { label: 'α', latex: '\\alpha ' },
  { label: 'β', latex: '\\beta ' },
  { label: 'γ', latex: '\\gamma ' },
  { label: 'δ', latex: '\\delta ' },
  { label: 'θ', latex: '\\theta ' },
  { label: 'λ', latex: '\\lambda ' },
  { label: 'μ', latex: '\\mu ' },
  { label: 'π', latex: '\\pi ' },
  { label: 'σ', latex: '\\sigma ' },
  { label: 'φ', latex: '\\phi ' },
  { label: 'ω', latex: '\\omega ' },
  { label: 'Δ', latex: '\\Delta ' },
  { label: 'Σ', latex: '\\Sigma ' },
  { label: 'Ω', latex: '\\Omega ' },
]

export function FormulaDialog() {
  const { t } = useTranslation()
  const { open, editor, latex: initialLatex, display: initialDisplay, editPos, hide } = useFormulaStore()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [latex, setLatex] = useState(initialLatex)
  const [display, setDisplay] = useState<FormulaDisplay>(initialDisplay)

  useEffect(() => {
    if (!open) return
    setLatex(initialLatex)
    setDisplay(initialDisplay)
  }, [open, initialLatex, initialDisplay])

  useEffect(() => {
    if (!open) return
    const element = dialogRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal?.()
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => {
      element?.close?.()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  if (!open) return null

  const { html, error } = validateAndRenderFormula(latex, display)
  const canSubmit = !!editor && !!latex.trim() && !error

  const insertSnippet = (snippet: string) => {
    const area = inputRef.current
    if (!area) {
      setLatex((current) => `${current}${snippet}`)
      return
    }
    const start = area.selectionStart ?? latex.length
    const end = area.selectionEnd ?? latex.length
    const next = `${latex.slice(0, start)}${snippet}${latex.slice(end)}`
    setLatex(next)
    requestAnimationFrame(() => {
      area.focus()
      const caret = start + snippet.length
      area.setSelectionRange(caret, caret)
    })
  }

  const submit = () => {
    if (!editor || !canSubmit) return
    applyFormula(editor, latex.trim(), display, editPos)
    hide()
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="insert-formula-title"
      onCancel={(event) => { event.preventDefault(); hide() }}
    >
      <header className={styles.header}>
        <h2 id="insert-formula-title">{editPos !== null ? t('formula.editTitle') : t('formula.insertTitle')}</h2>
        <button type="button" className={styles.dismiss} aria-label={t('formula.close')} onClick={hide}>×</button>
      </header>
      <div className={styles.body}>
        <div>
          <p className={styles.sectionLabel}>{t('formula.structures')}</p>
          <div className={styles.presets} role="group" aria-label="Formula structures">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={styles.chip}
                onClick={() => insertSnippet(preset.latex)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className={styles.sectionLabel}>{t('formula.symbols')}</p>
          <div className={styles.symbols} role="group" aria-label="Formula symbols">
            {SYMBOLS.map((symbol) => (
              <button
                key={symbol.label}
                type="button"
                className={styles.symbolChip}
                title={symbol.latex.trim()}
                onClick={() => insertSnippet(symbol.latex)}
              >
                {symbol.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.modeRow} role="radiogroup" aria-label="Formula display mode">
          <span className={styles.sectionLabel} style={{ margin: 0 }}>{t('formula.layout')}</span>
          <label>
            <input
              type="radio"
              name="formula-display"
              checked={display === 'block'}
              onChange={() => setDisplay('block')}
            />
            {t('formula.block')}
          </label>
          <label>
            <input
              type="radio"
              name="formula-display"
              checked={display === 'inline'}
              onChange={() => setDisplay('inline')}
            />
            {t('formula.inline')}
          </label>
        </div>
        <div>
          <label htmlFor="formula-latex-input" className={styles.sectionLabel} style={{ display: 'block' }}>
            {t('formula.latex')}
          </label>
          <textarea
            id="formula-latex-input"
            ref={inputRef}
            aria-label={t('formula.latex')}
            className={styles.input}
            value={latex}
            placeholder="e.g. \int_{a}^{b} f(x)\,dx = F(b) - F(a)"
            onChange={(event) => setLatex(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSubmit) {
                event.preventDefault()
                submit()
              }
            }}
          />
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </div>
        <div>
          <p className={styles.sectionLabel}>{t('formula.preview')}</p>
          <div
            className={styles.preview}
            aria-label="Formula preview"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
      <footer className={styles.footer}>
        <button type="button" onClick={hide}>{t('common.cancel')}</button>
        <button type="button" className={styles.primary} disabled={!canSubmit} onClick={submit}>
          {editPos !== null ? t('formula.update') : t('formula.insert')}
        </button>
      </footer>
    </dialog>
  )
}
