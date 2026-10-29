// @vitest-environment node
// Keeps the installer's content-folder path rules (src-tauri/nsis/hooks.nsh, GmNormalizeContentDir) in line
// with the Rust hint validator (src-tauri/src/portable.rs, parse_hint). NSIS code cannot run in a unit test,
// so this file holds a step-by-step JavaScript port of the rules R1-R6 documented at the top of hooks.nsh,
// checks it against the shared cases in src-tauri/nsis/hint-path-cases.json (the Rust test reads the same
// file), and statically asserts the structure of hooks.nsh that the port depends on.
// Manual checklist for the real installer: see docs/installer.md ("Manual test checklist").
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hooks = readFileSync(join(ROOT, 'src-tauri', 'nsis', 'hooks.nsh'), 'utf8').replaceAll('\r\n', '\n')
const portableRs = readFileSync(join(ROOT, 'src-tauri', 'src', 'portable.rs'), 'utf8').replaceAll('\r\n', '\n')
const cases = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'nsis', 'hint-path-cases.json'), 'utf8')) as {
  valid: string[]
  invalid: string[]
}

// The device list is read from hooks.nsh itself, so the port cannot drift from the script.
function nsisDeviceNames(): string[] {
  const block = hooks.split('GM-DEVICE-NAMES-BEGIN')[1].split('GM-DEVICE-NAMES-END')[0]
  return [...block.matchAll(/\$R5 == "([A-Z0-9$]+)"/g)].map((m) => m[1].replace(/\$\$/g, '$'))
}
function rustDeviceNames(): string[] {
  const block = portableRs.split('const DEVICE_NAMES')[1].split('];')[0]
  return [...block.matchAll(/"([A-Z0-9$]+)"/g)].map((m) => m[1])
}

const DEVICES = nsisDeviceNames()
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase() // NSIS "==" is case-insensitive

/** Port of GmNormalizeContentDir: returns the normalized path, or null when the installer rejects it. */
function normalize(input: string): string | null {
  let r0 = input
  while (r0.startsWith(' ')) r0 = r0.slice(1) // R1
  while (r0.endsWith(' ')) r0 = r0.slice(0, -1)
  if (r0.length === 0 || r0.length > 240) return null
  let r2 = '' // R2
  for (let i = 0; i < r0.length; i += 1) {
    let c = r0[i]
    if (c === '/') c = '\\'
    if ('<>"|?*\t\r\n'.includes(c)) return null
    if (c === ':' && i !== 1) return null
    r2 += c
  }
  while (r2.length > 3 && r2.endsWith('\\')) r2 = r2.slice(0, -1) // R3
  let unc = false // R4
  let rest: string
  if (r2.slice(0, 2) === '\\\\') {
    unc = true
    rest = r2.slice(2)
  } else {
    if (r2[1] !== ':' || r2[2] !== '\\') return null
    if (!/^[A-Za-z]$/.test(r2[0])) return null
    rest = r2.slice(3)
  }
  let count = 0 // R5, R6
  while (rest !== '') {
    const cut = rest.indexOf('\\')
    const segment = cut === -1 ? rest : rest.slice(0, cut)
    rest = cut === -1 || cut + 1 >= rest.length ? '' : rest.slice(cut + 1)
    count += 1
    if (segment === '' || segment === '.' || segment === '..') return null
    if (segment.endsWith('.') || segment.endsWith(' ')) return null
    if (unc && count === 2 && segment.endsWith('$')) return null
    const stem = segment.split('.')[0].replace(/ +$/, '')
    if (DEVICES.some((device) => eq(device, stem))) return null
  }
  if (unc && count < 2) return null
  return r2
}

describe('installer path rules (hooks.nsh) agree with the Rust hint validator', () => {
  it('accepts and rejects the shared cases', () => {
    for (const ok of cases.valid) expect(normalize(ok), JSON.stringify(ok)).not.toBeNull()
    for (const bad of cases.invalid) {
      // The shared inside-the-config-folder examples use the Rust test's fake profile, which is APPDATA here.
      expect(normalize(bad), JSON.stringify(bad)).toBeNull()
    }
    expect(cases.valid.length).toBeGreaterThanOrEqual(8)
    expect(cases.invalid.length).toBeGreaterThanOrEqual(25)
  })

  it('normalizes accepted paths the way the app stores them', () => {
    expect(normalize('D:/Books/Grimoire/')).toBe('D:\\Books\\Grimoire')
    expect(normalize('  E:\\Games  ')).toBe('E:\\Games')
    expect(normalize('C:\\a\\\\')).toBe('C:\\a')
    expect(normalize('C:\\')).toBe('C:\\')
  })

  it('enforces the 240 character limit like the Rust side', () => {
    expect(normalize(`C:\\${'a'.repeat(237)}`)).not.toBeNull()
    expect(normalize(`C:\\${'a'.repeat(238)}`)).toBeNull()
  })

  it('uses the same device name list as portable.rs', () => {
    expect(DEVICES).toHaveLength(24)
    expect(DEVICES).toEqual(rustDeviceNames())
  })
})

describe('hooks.nsh structure', () => {
  it('places optional content after the native install location, not before Welcome', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
    expect(config.bundle.windows.nsis.template).toBe('nsis/installer.nsi')
    const template = readFileSync('src-tauri/nsis/installer.nsi', 'utf8')
    const pages = [
      '!insertmacro MUI_PAGE_WELCOME',
      '!insertmacro MUI_PAGE_DIRECTORY',
      'Page custom GmContentPageCreate GmContentPageLeave',
      '!insertmacro MUI_PAGE_STARTMENU',
    ].map((page) => template.indexOf(page))
    expect(pages.every((position) => position >= 0)).toBe(true)
    expect(pages).toEqual([...pages].sort((a, b) => a - b))
    expect(template.match(/Page custom GmContentPageCreate GmContentPageLeave/g)).toHaveLength(1)
    expect(hooks).not.toContain('Page custom GmContentPageCreate GmContentPageLeave')
  })
  const functionBody = (name: string) => hooks.split(`Function ${name}\n`)[1].split('\nFunctionEnd')[0]
  const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length

  it('makes interactive content configuration opt-in without writing a new request when skipped', () => {
    expect(functionBody('GmContentPageCreate')).toContain('${NSD_CreateCheckbox}')
    expect(functionBody('GmContentPageCreate')).toContain('Call GmContentToggle')
    expect(functionBody('GmContentPageLeave')).toContain('${If} $GmCustomize <> ${BST_CHECKED}')
    const apply = functionBody('GmApplyContentDir')
    expect(apply.indexOf('$GmContentPageShown = 1')).toBeGreaterThan(-1)
    expect(apply.indexOf('$GmContentPageShown = 1')).toBeLessThan(apply.indexOf('Call GmNormalizeContentDir'))
    expect(apply).toContain('${AndIf} $GmCustomize <> ${BST_CHECKED}')
    expect(hooks).toContain('program installation folder selected on the previous page')
  })

  it('saves and restores the registers it uses', () => {
    const normalize = functionBody('GmNormalizeContentDir')
    expect(count(normalize, /^ {2}Push \$R\d$/gm)).toBe(10)
    expect(count(normalize, /^ {2}Pop \$R\d$/gm)).toBe(10)
    const apply = functionBody('GmApplyContentDir')
    expect(apply.trimStart().startsWith('Push $0')).toBe(true)
    expect(apply.trimEnd().endsWith('Pop $0')).toBe(true)
    // No early Return that would skip the Pop.
    expect(apply).not.toMatch(/^\s*Return\s*$/m)
  })

  it('shows the interactive page on upgrades but preserves unattended upgrade paths', () => {
    const detect = functionBody('GmDetectExisting')
    expect(detect).toContain('GriomoireMaker\\setting.json')
    expect(detect).toContain('GriomoireMaker\\library-paths.json')
    expect(functionBody('GmContentPageCreate')).not.toContain('Call GmDetectExisting')
    expect(functionBody('GmApplyContentDir')).toContain('Call GmDetectExisting')
  })

  it('states the real rules in the error text (no claim that a dollar sign is forbidden)', () => {
    const texts = hooks.split('\n').filter((line) => line.startsWith('LangString GmBadPath'))
    expect(texts).toHaveLength(2)
    for (const line of texts) {
      expect(line).not.toMatch(/< > : \$ /)
      expect(line).toContain('< > : $\\" | ? *')
      expect(line).toContain('C$$')
    }
  })

  it('accepts the configuration root and creates the requested layout', () => {
    expect(functionBody('GmNormalizeContentDir')).not.toContain('$APPDATA\\GriomoireMaker')
    for (const name of ['Mods\\Plugins', 'Mods\\Snippets', 'Mods\\Templates', 'Mods\\Themes', 'logs']) {
      expect(functionBody('GmApplyContentDir')).toContain(`CreateDirectory "$GmContentDir\\${name}"`)
    }
    expect(functionBody('GmPrefillContentDir')).toContain('$APPDATA\\GriomoireMaker')
    expect(functionBody('GmApplyContentDir')).toContain('install-content-root-v2.txt')
  })
})
