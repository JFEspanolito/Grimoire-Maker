import { expect, it } from 'vitest'
import { splitDiff } from './splitDiff'

it('aligns replacements, context and unequal changed blocks with line numbers', () => {
  const rows = splitDiff('--- a/x\n+++ b/x\n@@ -7,3 +9,4 @@\n-old\n+new\n+extra\n same\n-last\n')
  expect(rows).toEqual([
    { original: { text: 'old', number: 7, changed: true, kind: 'body' }, incoming: { text: 'new', number: 9, changed: true, kind: 'body' } },
    { original: undefined, incoming: { text: 'extra', number: 10, changed: true, kind: 'body' } },
    { original: { text: 'same', number: 8, changed: false, kind: 'body' }, incoming: { text: 'same', number: 11, changed: false, kind: 'body' } },
    { original: { text: 'last', number: 9, changed: true, kind: 'body' }, incoming: undefined },
  ])
})
it('retains header-looking content inside a hunk and new untracked files', () => {
  expect(splitDiff('@@ -1 +1 @@\n--- content\n+++ content')).toEqual([
    { original: { text: '-- content', number: 1, changed: true, kind: 'body' }, incoming: { text: '++ content', number: 1, changed: true, kind: 'body' } },
  ])
  expect(splitDiff('New file: new.md\n+++ content\n+more\n')).toEqual([
    { file: 'new.md' },
    { original: undefined, incoming: { text: '++ content', number: 1, changed: true, kind: 'body' } },
    { original: undefined, incoming: { text: 'more', number: 2, changed: true, kind: 'body' } },
  ])
})
it('omits Git metadata and presents HTML content as viewer text', () => {
  const rows = splitDiff('@@ -1 +1 @@\n-<script>old</script>\n+new\n\\ No newline at end of file\n')
  expect(rows).toEqual([
    { original: { text: 'old', number: 1, changed: true, kind: 'body' }, incoming: { text: 'new', number: 1, changed: true, kind: 'body' } },
  ])
  expect(splitDiff('old mode 100644\nnew mode 100755')).toEqual([])
})

it('bounds large previews and explicitly reports omitted lines', () => {
  const rows = splitDiff('New file: many.md\n' + '+line\n'.repeat(6000))
  expect(rows.at(-1)?.note).toContain('5,000')
  expect(rows.length).toBeLessThanOrEqual(5001)
})
