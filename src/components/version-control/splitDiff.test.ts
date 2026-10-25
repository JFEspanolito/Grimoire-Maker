import { expect, it } from 'vitest'
import { splitDiff } from './splitDiff'

it('aligns replacements, context and unequal changed blocks with line numbers', () => {
  const rows = splitDiff('--- a/x\n+++ b/x\n@@ -7,3 +9,4 @@\n-old\n+new\n+extra\n same\n-last\n')
  expect(rows[1]).toEqual({ original: { text: 'old', number: 7, changed: true }, incoming: { text: 'new', number: 9, changed: true } })
  expect(rows[2].original).toBeUndefined()
  expect(rows[2].incoming?.text).toBe('extra')
  expect(rows[3].original?.number).toBe(8)
  expect(rows[3].incoming?.number).toBe(11)
  expect(rows[4].incoming).toBeUndefined()
})
it('retains header-looking content inside a hunk and new untracked files', () => {
  expect(splitDiff('@@ -1 +1 @@\n--- content\n+++ content')[1].incoming?.text).toBe('++ content')
  expect(splitDiff('New file: new.md\n+++ content\n+more\n')[1].incoming?.text).toBe('++ content')
})
it('preserves metadata and missing-newline markers without rendering HTML', () => {
  const rows = splitDiff('@@ -1 +1 @@\n-<script>old</script>\n+new\n\\ No newline at end of file\n')
  expect(rows[1].original?.text).toBe('<script>old</script>')
  expect(rows[2].note).toContain('No newline')
  expect(splitDiff('old mode 100644\nnew mode 100755')).toHaveLength(2)
})

it('bounds large previews and explicitly reports omitted lines', () => {
  const rows = splitDiff('New file: many.md\n' + '+line\n'.repeat(6000))
  expect(rows.at(-1)?.note).toContain('5,000')
  expect(rows.length).toBeLessThanOrEqual(5001)
})
