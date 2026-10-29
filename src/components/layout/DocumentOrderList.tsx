import { moveItem, type OrderItem } from '../../lib/documentOrder'
import { useTranslation } from '../../lib/i18n'
import styles from './DocumentOrderList.module.css'

export const documentLabel = (path: string) => path.replace(/^Draft\//i, '').replace(/\.md$/i, '')

/** The Document Order rows: an include checkbox and move up/down buttons per Draft document. */
export function DocumentOrderList({ items, onChange, disabled = false }: {
  items: OrderItem[]
  onChange: (items: OrderItem[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return <ol className={styles.list} aria-label={t('order.documentsAria')}>
    {items.map((item, index) => <li key={item.path}>
      <label>
        <input type="checkbox" checked={item.included} disabled={disabled} aria-label={`${t('order.include')} ${documentLabel(item.path)}`}
          onChange={() => onChange(items.map((other, at) => at === index ? { ...other, included: !other.included } : other))} />
        <span title={item.path}>{documentLabel(item.path)}</span>
      </label>
      <button type="button" aria-label={`${t('order.move')} ${documentLabel(item.path)} ${t('order.up')}`} disabled={disabled || index === 0}
        onClick={() => onChange(moveItem(items, index, -1))}>↑</button>
      <button type="button" aria-label={`${t('order.move')} ${documentLabel(item.path)} ${t('order.down')}`} disabled={disabled || index === items.length - 1}
        onClick={() => onChange(moveItem(items, index, 1))}>↓</button>
    </li>)}
  </ol>
}
