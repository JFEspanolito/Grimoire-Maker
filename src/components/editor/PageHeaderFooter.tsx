import type { CSSProperties } from 'react'
import { dividerStyle, hasPageText, PAGE_TEXT_AREAS, PAGE_TEXT_POSITIONS, resolvePageText, type PageTextContext, type ThemeHeaderFooter } from '../../lib/themeHeaderFooter'

export function PageHeaderFooter({ layout, context, marginMm }: { layout?: ThemeHeaderFooter; context: PageTextContext; marginMm: number }) {
  if (!hasPageText(layout)) return null
  const style = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [`--page-text-${side}`, `${marginMm}mm`])) as CSSProperties
  return <div className="grimoire-page-text" data-theme-page-text style={style}>
    {PAGE_TEXT_AREAS.map(area => <div key={area} className={`grimoire-page-text-row grimoire-page-text-${area}`} style={dividerStyle(layout, area)}>
      {PAGE_TEXT_POSITIONS.map(position => <div key={position} className={`grimoire-page-text-${position}`}>{resolvePageText(layout[area][position], context)}</div>)}
    </div>)}
  </div>
}
