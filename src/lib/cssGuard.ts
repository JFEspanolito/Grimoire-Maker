/**
 * Detects CSS that makes the browser fetch something, or that hides such a fetch.
 *
 * A pattern match on the raw text is easy to evade (`@import/**\/"..."`, `u\72l(...)`),
 * so the text is first normalised the way a browser tokenises it: a comment is a
 * separator, and escapes (`\72`, `\/`) are decoded. Only then is it inspected.
 * It errs on the side of refusing: this is for CSS from packages the user did not write.
 */

const COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g
const ESCAPE = /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([\s\S])/g

/** Functions that can take an image from a URL or bare string, beyond `url()`. */
const FETCHING_FUNCTION = /(?<!\w)(?:-[a-z]+-)?(?:image-set|cross-fade|image|src|element)\s*\(/i
const URL_FUNCTION = /url\(/gi
const URL_WITH_ARGUMENT = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi

/** Any scheme (`https:`, `ftp:`, `file:`, `C:`) or a `//` or `\\` network path. */
const NON_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\\)/i
const INLINE_IMAGE = /^data:image\//i

function decodeEscapes(css: string): string {
  return css.replace(ESCAPE, (_match, hex: string | undefined, char: string | undefined) => {
    if (hex === undefined) return char ?? ''
    const code = parseInt(hex, 16)
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return valid ? String.fromCodePoint(code) : '�'
  })
}

/** Returns a short description of the first offending construct, or null if the CSS looks safe. */
export function findRemoteCssReference(css: string): string | null {
  const plain = css.replace(COMMENT, ' ')
  const text = decodeEscapes(plain)

  if (/@import/i.test(text)) return '@import'

  const fetching = FETCHING_FUNCTION.exec(text)
  if (fetching) return `${fetching[0].replace(/\s*\($/, '')}()`

  // An escape at the very start of a url() is how network paths and schemes are disguised.
  if (/url\(\s*['"]?\s*\\/i.test(plain)) return 'escape sequence at the start of url()'

  let seen = 0
  for (const match of text.matchAll(URL_WITH_ARGUMENT)) {
    seen++
    const argument = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (NON_LOCAL.test(argument) && !INLINE_IMAGE.test(argument)) return `url(${argument.slice(0, 40)})`
  }
  if ((text.match(URL_FUNCTION) ?? []).length > seen) return 'malformed url()'
  return null
}
