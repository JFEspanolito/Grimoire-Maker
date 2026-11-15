import { useTranslation, type TranslationKey } from '../../lib/i18n'
import { useProjectStore } from "../../stores/projectStore";
import { coAuthorNames } from "../../lib/projectContributors";
import { useDocumentStore } from "../../stores/documentStore";
import {
  bookName,
  emptyHeaderFooter,
  emptyDivider,
  dividerStyle,
  DIVIDER_SIDES,
  readThemeHeaderFooter,
  resolvePageText,
  PAGE_TEXT_AREAS,
  PAGE_TEXT_POSITIONS,
  PAGE_TEXT_TOKENS,
} from "../../lib/themeHeaderFooter";

import { ThemeBackgroundEditor } from "./ThemeBackgroundEditor";

import {
  readThemeDecorations,
  validateDecorations,
  type ThemeDecoration,
} from "../../lib/themeDecorations";

import { importThemeDecoration } from "../../lib/importThemeDecoration";

import { exportTheme } from "../../lib/modExport";

import { PAGE_SIZES } from "../../types/document";

import { friendlyErrorMessage, reportError } from "../../lib/errorLogging";

import { useEffect, useRef, useState } from "react";

import { isTauri } from "../../hooks/useFileSystem";

import { useSettingsStore } from "../../stores/settingsStore";

import { useThemeStore } from "../../stores/themeStore";

import { resolveTheme } from "../../lib/themes";

import {
  buildThemeCss,
  COLOR_FIELDS,
  loadThemeDraft,
  saveThemeDraft,
  themeColors,
  themeFonts,
  type ThemeColors,
  type ThemeDraft,
  type ThemeFonts,
} from "../../lib/themeEditor";
import { getAllFonts, loadExternalFont, findMatchingFontOption } from "../../lib/fonts";

import styles from "./ThemeCustomizer.module.css";

interface ThemeCustomizerProps {
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}

function preview(draft: ThemeDraft, colors: ThemeColors, fonts: ThemeFonts | undefined, t: (key: TranslationKey) => string): string {
  const css = buildThemeCss(
    draft.css,
    draft.theme.id,
    "sample",
    "Sample",
    colors,
    undefined,
    undefined,
    fonts,
  ).replaceAll("<", "\\3c ");

  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>

body { margin: 0; } article { padding: 24px; background: var(--page-bg); color: var(--page-fg); font: 16px/1.5 var(--page-font, Georgia, serif); }

h1,h2,h3 { font-family: var(--heading-font, Georgia, serif); line-height: 1.2; } hr { border: 0; border-top: 2px solid; }

.statblock { padding: 12px; background: var(--statblock-bg); } .readaloud { padding: 12px; background: var(--readaloud-bg); border-left: 3px solid var(--accent); }

${css}</style></head><body><article data-theme="sample"><div class="grimoire-content"><h1>${t('ui.sample.h1')}</h1><h2>${t('ui.sample.h2')}</h2><h3>${t('ui.sample.h3')}</h3><hr><p>${t('ui.sample.paragraph')}</p><p class="readaloud">${t('ui.sample.readaloud')}</p><div class="statblock"><strong>${t('ui.sample.guardian')}</strong><p>${t('ui.sample.stats')}</p></div></div></article></body></html>`;
}

/** Embedded in Preferences; the host owns its only modal and Escape handling. */

export function ThemeCustomizer({
  onClose,
  onBusyChange,
}: ThemeCustomizerProps) {
  const { t } = useTranslation();
  const workspace = useDocumentStore((state) => state.workspaceRoot);
  const project = useProjectStore((state) =>
    workspace ? state.entries[workspace]?.settings : undefined,
  );
  const { themes, userThemes } = useThemeStore();

  const [themeId] = useState(() =>
    resolveTheme(useSettingsStore.getState().theme, themes),
  );

  const [draft, setDraft] = useState<ThemeDraft | null>(null);

  const [colors, setColors] = useState(() => themeColors(""));

  const customFonts = useSettingsStore((state) => state.customFonts);
  const availableFonts = getAllFonts(customFonts);
  const [fonts, setFonts] = useState<ThemeFonts>(() => ({
    pageFont: "Georgia, serif",
    headingFont: "Palatino Linotype, Georgia, serif",
  }));

  const sections = [
    t('ui.theme_name'),
    t('ui.typography'),
    t('ui.colors'),
    t('ui.backgrounds'),
    t('ui.header_and_footer'),
  ] as const;

  const [section, setSection] = useState(0);

  const [headerFooter, setHeaderFooter] = useState(emptyHeaderFooter);

  const [name, setName] = useState("");

  const [decorations, setDecorations] = useState<ThemeDecoration[]>([]);

  const pageSize = useSettingsStore((state) => state.pageSize);

  const [busy, setBusy] = useState(false);

  const [operation, setOperation] = useState(t('ui.saving_theme'));

  const [error, setError] = useState("");

  const [notice, setNotice] = useState("");

  const locked = useRef(false);

  const busyCallback = useRef(onBusyChange);

  busyCallback.current = onBusyChange;

  useEffect(() => {
    let cancelled = false;

    const selected = themes.find((theme) => theme.id === themeId);

    if (!isTauri()) {
      setError(t('ui.custom_themes_can_be_saved_in_the_desktop_app'));
      return;
    }

    if (!selected) {
      setError(t('ui.the_selected_theme_is_no_longer_available'));
      return;
    }

    void loadThemeDraft(
      selected,
      userThemes.some((theme) => theme.id === selected.id),
    ).then(
      (value) => {
        if (cancelled) return;

        setDecorations(readThemeDecorations(value.css));

        setHeaderFooter(
          readThemeHeaderFooter(value.css) ?? emptyHeaderFooter(),
        );

        setDraft(value);

        setColors(themeColors(value.css));

        setFonts(themeFonts(value.css));

        setName(value.path ? selected.name : t('ui.copyName', { name: selected.name }));
      },
      (cause: unknown) => {
        if (!cancelled) {
          reportError("theme.customize.load", cause);
          setError(friendlyErrorMessage(cause, t('ui.could_not_load_this_theme_for_customization')));
        }
      },
    );

    return () => {
      cancelled = true;
    };

    // Capture the selected source once; catalog reload is part of the explicit Save transaction.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (copy: boolean) => {
    if (!draft || locked.current) return;

    locked.current = true;

    setOperation(t('ui.saving_theme'));

    setBusy(true);

    busyCallback.current?.(true);

    setError("");

    try {
      const saved = await saveThemeDraft(
        draft,
        name,
        colors,
        copy,
        themes.map((theme) => theme.id),
        decorations,
        headerFooter,
        fonts,
      );

      await useThemeStore.getState().reload();

      const refreshed = useThemeStore.getState();

      if (
        !refreshed.userThemes.some((theme) => theme.id === saved.id) ||
        refreshed.errors.length
      ) {
        throw new Error(
          t('ui.themeReloadFailed', { errors: refreshed.errors.join('; ') }),
        );
      }

      useSettingsStore.getState().setTheme(saved.id);

      onClose();
    } catch (cause) {
      reportError("theme.customize.save", cause);

      setError(friendlyErrorMessage(cause, t('ui.could_not_save_the_theme')));
    } finally {
      locked.current = false;

      setBusy(false);

      busyCallback.current?.(false);
    }
  };

  /** Exports the saved copy of the theme being edited; unsaved edits are not part of the file. */
  const exportCurrent = async () => {
    if (!draft?.path || locked.current) return;

    locked.current = true;

    setOperation(t('ui.exporting_theme'));

    setBusy(true);

    busyCallback.current?.(true);

    setError("");

    setNotice("");

    try {
      const result = await exportTheme(draft.theme.id);

      if (result) {
        setNotice(
          typeof result === "string" ? t('ui.themeSavedTo', { path: result }) : t('ui.theme_exported'),
        );
      }
    } catch (cause) {
      reportError("theme.customize.export", cause);

      setError(friendlyErrorMessage(cause, t('ui.could_not_export_the_theme')));
    } finally {
      locked.current = false;

      setBusy(false);

      busyCallback.current?.(false);
    }
  };

  const importBackground = async () => {
    if (locked.current) return;

    locked.current = true;

    setOperation(t('ui.importing_background_image'));

    setBusy(true);

    busyCallback.current?.(true);

    setError("");

    try {
      const image = await importThemeDecoration();

      if (image) setDecorations(validateDecorations([...decorations, image]));
    } catch (cause) {
      reportError("theme.background.import", cause);

      setError(friendlyErrorMessage(cause, t('ui.could_not_import_the_background_image')));
    } finally {
      locked.current = false;

      setBusy(false);

      busyCallback.current?.(false);
    }
  };

  return (
    <section
      className={styles.customizer}
      aria-labelledby="customize-theme-title"
      aria-busy={busy}
    >
      <header className={styles.header}>
        <h2 id="customize-theme-title">{t('ui.customize_theme')}</h2>
        <button type="button" disabled={busy} onClick={onClose}>
          {t('ui.back')}
        </button>
      </header>

      <p className={styles.description}>
        {draft?.path
          ? t('ui.save_updates_this_user_theme_save_as_creates_a_separate_copy')
          : t('ui.built_in_and_template_themes_are_kept_intact_save_creates_a_named_copy')}{" "}
        {t('ui.dividerColorHint')}
      </p>

      <div className={styles.sectionLayout}>
        <nav
          className={styles.sections}
          role="tablist"
          aria-label={t('ui.theme_sections')}
          aria-orientation="vertical"
        >
          {sections.map((label, index) => (
            <button
              key={label}
              type="button"
              role="tab"
              id={`theme-tab-${index}`}
              aria-controls={`theme-panel-${index}`}
              aria-selected={section === index}
              tabIndex={section === index ? 0 : -1}
              disabled={busy}
              onClick={() => setSection(index)}
              onKeyDown={(event) => {
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? sections.length - 1
                      : event.key === "ArrowDown"
                        ? (index + 1) % sections.length
                        : event.key === "ArrowUp"
                          ? (index + sections.length - 1) % sections.length
                          : null;

                if (next === null) return;

                event.preventDefault();

                setSection(next);

                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`#theme-tab-${next}`)
                  ?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className={styles.sectionContent}>
          {draft && (
            <>
              <section
                role="tabpanel"
                id="theme-panel-0"
                aria-labelledby="theme-tab-0"
                hidden={section !== 0}
              >
                <label className={styles.name}>
                  {t('ui.theme_name')}
                  <input
                    aria-label={t('ui.theme_name')}
                    maxLength={80}
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              </section>

              <section
                role="tabpanel"
                id="theme-panel-1"
                aria-labelledby="theme-tab-1"
                hidden={section !== 1}
              >
                <div className={styles.workspace}>
                  <div className={styles.typography}>
                    <label>
                      {t('ui.document_font')}
                      <select
                        aria-label={t('ui.theme_document_font')}
                        value={findMatchingFontOption(availableFonts, fonts.pageFont)?.family ?? ''}
                        disabled={busy}
                        onChange={(event) => {
                          const val = event.target.value;
                          if (val) loadExternalFont(val);
                          setFonts((current) => ({ ...current, pageFont: val || undefined }));
                        }}
                      >
                        {availableFonts.map((f) => (
                          <option key={f.id} value={f.family}>{f.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('ui.heading_font')}
                      <select
                        aria-label={t('ui.theme_heading_font')}
                        value={findMatchingFontOption(availableFonts, fonts.headingFont)?.family ?? ''}
                        disabled={busy}
                        onChange={(event) => {
                          const val = event.target.value;
                          if (val) loadExternalFont(val);
                          setFonts((current) => ({ ...current, headingFont: val || undefined }));
                        }}
                      >
                        {availableFonts.map((f) => (
                          <option key={f.id} value={f.family}>{f.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <iframe
                    title={t('ui.theme_typography_preview')}
                    sandbox=""
                    className={styles.preview}
                    srcDoc={preview(draft, colors, fonts, t)}
                  />
                </div>
              </section>

              <section
                role="tabpanel"
                id="theme-panel-2"
                aria-labelledby="theme-tab-2"
                hidden={section !== 2}
              >
                <div className={styles.workspace}>
                  <div className={styles.colors}>
                    {(
                      Object.entries(COLOR_FIELDS) as [
                        keyof ThemeColors,
                        string,
                      ][]
                    ).map(([key]) => (
                      <label key={key}>
                        {t(`ui.color.${key}`)}
                        <input
                          aria-label={t(`ui.color.${key}`)}
                          type="color"
                          value={colors[key]}
                          disabled={busy}
                          onChange={(event) =>
                            setColors((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>

                  <iframe
                    title={t('ui.theme_preview')}
                    sandbox=""
                    className={styles.preview}
                    srcDoc={preview(draft, colors, fonts, t)}
                  />
                </div>
              </section>

              <section
                role="tabpanel"
                id="theme-panel-3"
                aria-labelledby="theme-tab-3"
                hidden={section !== 3}
              >
                <ThemeBackgroundEditor
                  images={decorations}
                  onChange={setDecorations}
                  onImport={() => void importBackground()}
                  disabled={busy}
                  pageWidthMm={PAGE_SIZES[pageSize].widthMm}
                  pageHeightMm={PAGE_SIZES[pageSize].heightMm}
                  background={colors.background}
                  foreground={colors.text}
                />
              </section>

              <section
                role="tabpanel"
                id="theme-panel-4"
                aria-labelledby="theme-tab-4"
                hidden={section !== 4}
              >
                <h3>{t('ui.header_and_footer')}</h3>

                <p className={styles.description}>
                  {t('ui.text_repeats_on_every_page_use_fixed_text_or_these_placeholders')}
                </p>

                <ul>
                  {Object.keys(PAGE_TEXT_TOKENS).map((token) => (
                    <li key={token}>
                      <code>{token}</code> — {t(`ui.token.${token.slice(1, -1)}` as TranslationKey)}
                    </li>
                  ))}
                </ul>

                <div className={`${styles.backgroundWorkspace} ${styles.headerFooterWorkspace}`}>
                  <div className={styles.headerFooterControls}>
                    {PAGE_TEXT_AREAS.map((area) => (
                      <fieldset
                        key={area}
                        className={styles.pageText}
                        disabled={busy}
                      >
                        <legend>
                          {area === "header" ? t('ui.header') : t('ui.footer')}
                        </legend>

                        {PAGE_TEXT_POSITIONS.map((position) => (
                          <label key={position}>
                            {t(`ui.position.${position}`)}

                            <input
                              aria-label={t('ui.textSlot', { area: t(area === 'header' ? 'ui.header' : 'ui.footer'), position: t(`ui.slot.${position}`) })}
                              maxLength={500}
                              value={headerFooter[area][position]}
                              onChange={(event) => {
                                const value = event.target.value;

                                setHeaderFooter((current) => ({
                                  ...current,
                                  [area]: {
                                    ...current[area],
                                    [position]: value,
                                  },
                                }));
                              }}
                            />
                          </label>
                        ))}
                      </fieldset>
                    ))}
                    <fieldset className={styles.pageText} disabled={busy}>
                      <legend>{t('ui.divider')}</legend>
                      {PAGE_TEXT_AREAS.map(area => <fieldset key={area} className={styles.dividerRow}>
                        <legend>{area === 'header' ? t('ui.header') : t('ui.footer')}</legend>
                        {DIVIDER_SIDES.map(side => <label key={side}>
                          <input type="checkbox" aria-label={t('ui.dividerSide', { area: t(`ui.area.${area}`), side: t(`ui.slot.${side}`) })}
                            checked={headerFooter.divider?.[area][side] ?? false}
                            onChange={event => {
                              const checked = event.target.checked;
                              setHeaderFooter(current => {
                                const divider = current.divider ?? emptyDivider();
                                return { ...current, divider: { ...divider, [area]: { ...divider[area], [side]: checked } } };
                              });
                            }} />
                          {t(`ui.position.${side}`)}
                        </label>)}
                      </fieldset>)}
                      <label>{t('ui.color')}
                        <input type="color" aria-label={t('ui.header_and_footer_divider_color')}
                          value={headerFooter.divider?.color ?? emptyDivider().color}
                          onChange={event => {
                            const color = event.target.value;
                            setHeaderFooter(current => ({ ...current, divider: { ...(current.divider ?? emptyDivider()), color } }));
                          }} />
                      </label>
                    </fieldset>
                  </div>
                  <div
                    className={styles.headerFooterPreview}
                    role="img"
                    aria-label={t('ui.header_and_footer_page_preview')}
                    style={{
                      aspectRatio: `${PAGE_SIZES[pageSize].widthMm} / ${PAGE_SIZES[pageSize].heightMm}`,
                      background: colors.background,
                      color: colors.text,
                    }}
                  >
                    {decorations.map((item) => (
                      <img
                        key={item.id}
                        src={item.dataUrl}
                        alt=""
                        className={styles.previewArtwork}
                        style={{
                          left: `${(item.xMm / PAGE_SIZES[pageSize].widthMm) * 100}%`,
                          top: `${((item.anchor === "footer" ? PAGE_SIZES[pageSize].heightMm - item.yMm - item.heightMm : item.yMm) / PAGE_SIZES[pageSize].heightMm) * 100}%`,
                          width: `${(item.widthMm / PAGE_SIZES[pageSize].widthMm) * 100}%`,
                          height: `${(item.heightMm / PAGE_SIZES[pageSize].heightMm) * 100}%`,
                        }}
                      />
                    ))}
                    <div className={styles.backgroundSample}>
                      <strong style={{ color: colors.h1 }}>{t('ui.chapter_one')}</strong>
                      <p>{t('ui.your_text_stays_above_the_background_artwork')}</p>
                    </div>
                    {PAGE_TEXT_AREAS.map((area) => (
                      <div
                        key={area}
                        className={styles.previewTextRow}
                        data-area={area}
                        style={dividerStyle(headerFooter, area)}
                      >
                        {PAGE_TEXT_POSITIONS.map((position) => (
                          <span key={position} style={{ textAlign: position }}>
                            {resolvePageText(headerFooter[area][position], {
                              book:
                                project?.name ||
                                bookName(workspace) ||
                                t('ui.sample_book'),
                              title: t('ui.chapter_one'),
                              author: project?.author || t('ui.sample_author'),
                              coAuthor:
                                coAuthorNames(project) || t('ui.sample_co_author'),
                              page: 1,
                              pages: 10,
                            })}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <p className={styles.description}>
                  {t('ui.preview_uses_project_credits_when_available_and_sample_values_otherwise_title_an')}
                </p>
              </section>

              <p className={styles.description}>
                {t('ui.preview_only_your_document_changes_after_save_custom_css_colors_outside_six_digi')}
              </p>
            </>
          )}

          {!draft && !error && <p role="status">{t('ui.loading_theme')}</p>}

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          {busy && <p role="status">{operation}</p>}

          {notice && !busy && <p role="status">{notice}</p>}
        </div>
      </div>

      <footer className={styles.footer}>
        <button type="button" disabled={busy} onClick={onClose}>
          {t('ui.cancel')}
        </button>

        {draft?.path && (
          <button type="button" disabled={busy} onClick={() => void exportCurrent()}>
            {t('ui.export')}
          </button>
        )}

        {draft?.path && (
          <button type="button" disabled={busy} onClick={() => void save(true)}>
            {t('ui.save_as')}
          </button>
        )}

        <button
          type="button"
          data-action="save"
          disabled={!draft || busy}
          onClick={() => void save(!draft?.path)}
        >
          {draft?.path ? t('ui.save') : t('ui.save_new_theme')}
        </button>
      </footer>
    </section>
  );
}
