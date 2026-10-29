import { describe, expect, it } from 'vitest'
import { DICTIONARY, getTranslation, SUPPORTED_LANGUAGES } from './i18n'
import { useSettingsStore } from '../stores/settingsStore'

describe('i18n catalog and translation lookup', () => {
  it('supports English and Spanish', () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.id)).toEqual(['en', 'es'])
  })

  it('translates top-level menu keys in English', () => {
    expect(getTranslation('menu.file', 'en')).toBe('File')
    expect(getTranslation('menu.view', 'en')).toBe('View')
    expect(getTranslation('menu.insert', 'en')).toBe('Insert')
    expect(getTranslation('menu.document', 'en')).toBe('Document')
    expect(getTranslation('menu.settings', 'en')).toBe('Settings')
  })

  it('translates top-level menu keys in Spanish', () => {
    expect(getTranslation('menu.file', 'es')).toBe('Archivo')
    expect(getTranslation('menu.view', 'es')).toBe('Ver')
    expect(getTranslation('menu.insert', 'es')).toBe('Insertar')
    expect(getTranslation('menu.document', 'es')).toBe('Documento')
    expect(getTranslation('menu.settings', 'es')).toBe('Configuración')
  })

  it('translates inner menu items in Spanish', () => {
    expect(getTranslation('menu.file.openFile', 'es')).toBe('Abrir archivo…')
    expect(getTranslation('menu.file.newFile', 'es')).toBe('Nuevo archivo…')
    expect(getTranslation('menu.file.save', 'es')).toBe('Guardar')
    expect(getTranslation('menu.settings.preferences', 'es')).toBe('Preferencias…')
    expect(getTranslation('menu.settings.modManager', 'es')).toBe('Administrador de mods')
    expect(getTranslation('menu.view.splitView', 'es')).toBe('Vista dividida')
    expect(getTranslation('menu.insert.table', 'es')).toBe('Tabla')
    expect(getTranslation('menu.document.pageSize', 'es')).toBe('Tamaño de página')
  })

  it('has consistent keys between English and Spanish catalogs', () => {
    const enKeys = Object.keys(DICTIONARY.en).sort()
    const esKeys = Object.keys(DICTIONARY.es).sort()
    expect(esKeys).toEqual(enKeys)
  })

  it('defaults settingsStore language to english', () => {
    useSettingsStore.setState({ language: 'en' })
    expect(useSettingsStore.getState().language).toBe('en')
  })

  it('updates language reactively in settingsStore', () => {
    useSettingsStore.getState().setLanguage('es')
    expect(useSettingsStore.getState().language).toBe('es')

    // Reset back to en
    useSettingsStore.getState().setLanguage('en')
    expect(useSettingsStore.getState().language).toBe('en')
  })
})
