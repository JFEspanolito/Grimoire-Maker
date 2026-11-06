import { describe, expect, it, beforeEach } from 'vitest'
import {
  BASE_FONTS,
  getAllFonts,
  findMatchingFontOption,
  loadExternalFont,
  extractFontName,
  arrayBufferToBase64,
  registerFontFile,
} from './fonts'

describe('fonts library', () => {
  beforeEach(() => {
    document.head.querySelectorAll('link[id^="grimoire-font-"]').forEach((el) => el.remove())
    document.head.querySelectorAll('style[id^="grimoire-local-font-"]').forEach((el) => el.remove())
  })

  it('exposes base fonts list', () => {
    expect(BASE_FONTS.length).toBeGreaterThanOrEqual(8)
    expect(BASE_FONTS.some((f) => f.id === 'georgia')).toBe(true)
    expect(BASE_FONTS.some((f) => f.id === 'cinzel')).toBe(true)
  })

  it('extracts font names from clean names, URLs, and file paths', () => {
    expect(extractFontName('MedievalSharp')).toBe('MedievalSharp')
    expect(extractFontName('https://fonts.googleapis.com/css2?family=MedievalSharp&display=swap')).toBe('MedievalSharp')
    expect(extractFontName('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&display=swap')).toBe('Cinzel Decorative')
    expect(extractFontName('C:\\Users\\Fonts\\AncientGothic.ttf')).toBe('AncientGothic')
    expect(extractFontName('/usr/share/fonts/MagicBook.otf')).toBe('MagicBook')
  })

  it('combines base fonts with custom fonts in getAllFonts', () => {
    const fonts = getAllFonts(['MedievalSharp', '  Roboto  ', 'https://fonts.googleapis.com/css2?family=Cinzel+Decorative&display=swap'])
    expect(fonts.length).toBe(BASE_FONTS.length + 3)
    expect(fonts.some((f) => f.id === 'medievalsharp' && f.label === 'MedievalSharp')).toBe(true)
    expect(fonts.some((f) => f.id === 'roboto' && f.label === 'Roboto')).toBe(true)
    expect(fonts.some((f) => f.label === 'Cinzel Decorative')).toBe(true)
  })

  it('matches font options correctly by family, primary name, or id', () => {
    const fonts = getAllFonts(['MedievalSharp'])
    expect(findMatchingFontOption(fonts, 'Georgia, serif')?.id).toBe('georgia')
    expect(findMatchingFontOption(fonts, 'Georgia')?.id).toBe('georgia')
    expect(findMatchingFontOption(fonts, '"Cinzel", Georgia, serif')?.id).toBe('cinzel')
    expect(findMatchingFontOption(fonts, 'MedievalSharp')?.id).toBe('medievalsharp')
    expect(findMatchingFontOption(fonts, 'NonExistent')).toBeUndefined()
    expect(findMatchingFontOption(fonts, undefined)).toBeUndefined()
  })

  it('loads external fonts via Google Fonts display=swap and handles direct URLs', () => {
    loadExternalFont('Arial')
    expect(document.getElementById('grimoire-font-arial')).toBeNull()

    loadExternalFont('MedievalSharp')
    const link = document.getElementById('grimoire-font-medievalsharp') as HTMLLinkElement | null
    expect(link).not.toBeNull()
    expect(link?.href).toContain('family=MedievalSharp&display=swap')

    loadExternalFont('https://fonts.googleapis.com/css2?family=Roboto&display=swap')
    expect(document.querySelector('link[href*="Roboto"]')).not.toBeNull()
  })

  it('registers local font files via @font-face style', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'MyFancyFont.ttf', { type: 'font/ttf' })
    const fontName = await registerFontFile(file)
    expect(fontName).toBe('MyFancyFont')
    const style = document.getElementById('grimoire-local-font-myfancyfont') as HTMLStyleElement | null
    expect(style).not.toBeNull()
    expect(style?.textContent).toContain("@font-face { font-family: 'MyFancyFont'")
    expect(style?.textContent).toContain('data:font/ttf;base64,')
  })
})
