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

/** A table with a header row and `rows` empty body rows, as editor JSON. */
export function buildTable(headers: string[], rows: number): object {
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: headers.map((h) => cell('tableHeader', h)) },
      ...Array.from({ length: rows }, () => ({
        type: 'tableRow',
        content: headers.map(() => cell('tableCell')),
      })),
    ],
  }
}
