import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'

/**
 * Tables are stored as GFM Markdown (tiptap-markdown does this when the first row is
 * all header cells), so encounter and loot tables stay readable in any editor.
 * Column resizing is off: Markdown cannot store column widths.
 */
export const TableExtensions = [Table.configure({ resizable: false }), TableRow, TableHeader, TableCell]

function cell(type: 'tableHeader' | 'tableCell', text?: string): object {
  return {
    type,
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }],
  }
}

/**
 * A table with a header row and `rows` body rows, as editor JSON. `values[row][col]`
 * pre-fills cells (roll numbers, default scores); every other cell stays empty.
 */
export function buildTable(headers: string[], rows: number, values: string[][] = []): object {
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: headers.map((h) => cell('tableHeader', h)) },
      ...Array.from({ length: rows }, (_, row) => ({
        type: 'tableRow',
        content: headers.map((_, col) => cell('tableCell', values[row]?.[col])),
      })),
    ],
  }
}
