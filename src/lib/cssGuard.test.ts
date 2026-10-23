import { describe, expect, it } from 'vitest'
import { findRemoteCssReference } from './cssGuard'

describe('findRemoteCssReference: things a browser would fetch or that hide a fetch', () => {
  it.each([
    ['plain @import', "@import 'https://evil.example/a.css';"],
    ['@import without whitespace', '@import"https://evil.example/a.css";'],
    ['@import split by a comment', '@import/**/"https://evil.example/a.css";'],
    ['uppercase @IMPORT', "@IMPORT url('https://evil.example/a.css');"],
    ['escaped at-rule name', '@\\69mport "https://evil.example/a.css";'],
    ['local @import (not allowed in a package)', "@import 'other.css';"],
    ['https url()', 'a{background:url(https://evil.example/p.png)}'],
    ['quoted https url() with spaces', 'a{background:url( "https://evil.example/p.png" )}'],
    ['comment inside url()', 'a{background:url(/**/"https://evil.example/p.png")}'],
    ['escaped function name', 'a{background:u\\72l(https://evil.example/p.png)}'],
    ['escaped function name, other letter', 'a{background:\\75rl(https://evil.example/p.png)}'],
    ['escaped scheme', 'a{background:url(h\\74tps://evil.example/p.png)}'],
    ['escaped slashes', 'a{background:url(\\2f\\2f evil.example/x)}'],
    ['protocol-relative url()', 'a{background:url(//evil.example/p.png)}'],
    ['ftp url()', 'a{background:url(ftp://evil.example/p.png)}'],
    ['UNC path url()', 'a{background:url(\\\\host\\share\\x.png)}'],
    ['file: url()', 'a{background:url(file:///C:/Users/x/secret.png)}'],
    ['drive path url()', 'a{background:url(C:/Users/x/secret.png)}'],
    ['image-set with a string', 'a{background:image-set("https://evil.example/p.png" 1x)}'],
    ['prefixed image-set', 'a{background:-webkit-image-set("//evil.example/p.png" 1x)}'],
    ['image-set inside a property', 'a{cursor:image-set("//evil.example/p.png" 1x),auto}'],
    ['src() function', 'a{background:src("https://evil.example/p.png")}'],
    ['cross-fade', 'a{background:cross-fade(url(a.png),"https://evil.example/p.png",50%)}'],
  ])('flags %s', (_label, css) => {
    expect(findRemoteCssReference(css)).not.toBeNull()
  })

  it('names the offending construct', () => {
    expect(findRemoteCssReference('@import "https://evil.example/a.css";')).toMatch(/@import/)
    expect(findRemoteCssReference('a{background:url(https://evil.example/p.png)}')).toMatch(/url/)
  })
})

describe('findRemoteCssReference: ordinary theme CSS stays allowed', () => {
  it.each([
    ['custom properties and selectors', "[data-theme='x']{--page-bg:#fff;--accent:#9c2b1a}"],
    ['a local relative url()', 'a{background:url(assets/bg.png)}'],
    ['a quoted local url()', "a{background:url('assets/bg.png')}"],
    ['an inline data image', 'a{background:url(data:image/png;base64,iVBORw0KGgo=)}'],
    ['a decorative quote written as a CSS escape', 'blockquote::before{content:"\\201C"}'],
    ['a commented-out remote @import', '/* @import "https://evil.example/a.css"; */ a{color:red}'],
    ['a font stack', "a{font-family:'Palatino Linotype',Georgia,serif}"],
    ['@font-face without a source url', 'a{font-display:swap}'],
  ])('allows %s', (_label, css) => {
    expect(findRemoteCssReference(css)).toBeNull()
  })
})
