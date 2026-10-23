import type { CSSProperties, ReactNode } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { PAGE_SIZES } from '../../types/document'
import { usePluginRegistry } from '../../plugins/plugin-manager'

/**
 * Virtual physical sheet. Real pagination (Paged.js) runs at export time; the
 * canvas shows one sheet at true millimetre size with column layout applied.
 */
export function PageView({ children }: { children: ReactNode }) {
  const { pageSize, columns, marginMm } = useSettingsStore()
  const overlays = usePluginRegistry((s) => s.overlays)
  const size = PAGE_SIZES[pageSize]

  const style: CSSProperties = {
    width: `${size.widthMm}mm`,
    minHeight: `${size.heightMm}mm`,
    padding: `${marginMm}mm`,
    columnCount: columns,
  }

  return (
    <div className="mx-auto my-8 w-fit">
      <div className="grimoire-page relative shadow-xl" style={style}>
        {children}
        {overlays.map(({ id, component: Overlay }) => (
          <Overlay key={id} />
        ))}
      </div>
    </div>
  )
}
