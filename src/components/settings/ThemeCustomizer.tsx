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
  type ThemeColors,
  type ThemeDraft,
} from "../../lib/themeEditor";

import styles from "./ThemeCustomizer.module.css";

interface ThemeCustomizerProps {
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}

function preview(draft: ThemeDraft, colors: ThemeColors): string {
  const css = buildThemeCss(
    draft.css,
    draft.theme.id,
    "sample",
    "Sample",
    colors,
  ).replaceAll("<", "\\3c ");

  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>

body { margin: 0; } article { padding: 24px; background: var(--page-bg); color: var(--page-fg); font: 16px/1.5 var(--page-font, Georgia, serif); }

h1,h2,h3 { font-family: var(--heading-font, Georgia, serif); line-height: 1.2; } hr { border: 0; border-top: 2px solid; }

.statblock { padding: 12px; background: var(--statblock-bg); } .readaloud { padding: 12px; background: var(--readaloud-bg); border-left: 3px solid var(--accent); }

${css}</style></head><body><article data-theme="sample"><div class="grimoire-content"><h1>H1: Chapter One</h1><h2>H2: The ancient library</h2><h3>H3: A hidden passage</h3><hr><p>P: A new adventure begins. This sample stays separate from your document.</p><p class="readaloud">A quiet voice echoes through the hall.</p><div class="statblock"><strong>Library guardian</strong><p>Armor 12 · Health 24</p></div></div></article></body></html>`;
}

/** Embedded in Preferences; the host owns its only modal and Escape handling. */

export function ThemeCustomizer({
  onClose,
  onBusyChange,
}: ThemeCustomizerProps) {
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

  const sections = [
    "Theme name",
    "Colors",
    "Backgrounds",
    "Header and footer",
  ] as const;

  const [section, setSection] = useState(0);

  const [headerFooter, setHeaderFooter] = useState(emptyHeaderFooter);

  const [name, setName] = useState("");

  const [decorations, setDecorations] = useState<ThemeDecoration[]>([]);

  const pageSize = useSettingsStore((state) => state.pageSize);

  const [busy, setBusy] = useState(false);

  const [operation, setOperation] = useState("Saving theme…");

  const [error, setError] = useState("");

  const locked = useRef(false);

  const busyCallback = useRef(onBusyChange);

  busyCallback.current = onBusyChange;

  useEffect(() => {
    let cancelled = false;

    const selected = themes.find((theme) => theme.id === themeId);

    if (!isTauri()) {
      setError("Custom themes can be saved in the desktop app.");
      return;
    }

    if (!selected) {
      setError("The selected theme is no longer available.");
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

        setName(value.path ? selected.name : `${selected.name} Copy`);
      },
      (cause: unknown) => {
        if (!cancelled) {
          reportError("theme.customize.load", cause);
          setError(friendlyErrorMessage(cause, "Could not load this theme for customization."));
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

    setOperation("Saving theme…");

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
      );

      await useThemeStore.getState().reload();

      const refreshed = useThemeStore.getState();

      if (
        !refreshed.userThemes.some((theme) => theme.id === saved.id) ||
        refreshed.errors.length
      ) {
        throw new Error(
          `Theme saved, but could not be reloaded. ${refreshed.errors.join("; ")} Reopen Preferences after resolving the folder errors.`,
        );
      }

      useSettingsStore.getState().setTheme(saved.id);

      onClose();
    } catch (cause) {
      reportError("theme.customize.save", cause);

      setError(friendlyErrorMessage(cause, "Could not save the theme."));
    } finally {
      locked.current = false;

      setBusy(false);

      busyCallback.current?.(false);
    }
  };

  const importBackground = async () => {
    if (locked.current) return;

    locked.current = true;

    setOperation("Importing background image…");

    setBusy(true);

    busyCallback.current?.(true);

    setError("");

    try {
      const image = await importThemeDecoration();

      if (image) setDecorations(validateDecorations([...decorations, image]));
    } catch (cause) {
      reportError("theme.background.import", cause);

      setError(friendlyErrorMessage(cause, "Could not import the background image."));
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
        <h2 id="customize-theme-title">Customize Theme</h2>
        <button type="button" disabled={busy} onClick={onClose}>
          Back
        </button>
      </header>

      <p className={styles.description}>
        {draft?.path
          ? "Save updates this user theme. Save As creates a separate copy."
          : "Built-in and template themes are kept intact. Save creates a named copy."}{" "}
        Divider color applies throughout the theme.
      </p>

      <div className={styles.sectionLayout}>
        <nav
          className={styles.sections}
          role="tablist"
          aria-label="Theme sections"
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
                  Theme name
                  <input
                    aria-label="Theme name"
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
                  <div className={styles.colors}>
                    {(
                      Object.entries(COLOR_FIELDS) as [
                        keyof ThemeColors,
                        string,
                      ][]
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          aria-label={label}
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
                    title="Theme preview"
                    sandbox=""
                    className={styles.preview}
                    srcDoc={preview(draft, colors)}
                  />
                </div>
              </section>

              <section
                role="tabpanel"
                id="theme-panel-2"
                aria-labelledby="theme-tab-2"
                hidden={section !== 2}
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
                id="theme-panel-3"
                aria-labelledby="theme-tab-3"
                hidden={section !== 3}
              >
                <h3>Header and footer</h3>

                <p className={styles.description}>
                  Text repeats on every page. Use fixed text or these
                  placeholders:
                </p>

                <ul>
                  {Object.entries(PAGE_TEXT_TOKENS).map(([token, label]) => (
                    <li key={token}>
                      <code>{token}</code> — {label}
                    </li>
                  ))}
                </ul>

                <div className={styles.backgroundWorkspace}>
                  <div>
                    {PAGE_TEXT_AREAS.map((area) => (
                      <fieldset
                        key={area}
                        className={styles.pageText}
                        disabled={busy}
                      >
                        <legend>
                          {area === "header" ? "Header" : "Footer"}
                        </legend>

                        {PAGE_TEXT_POSITIONS.map((position) => (
                          <label key={position}>
                            {position[0].toUpperCase() + position.slice(1)}

                            <input
                              aria-label={`${area === "header" ? "Header" : "Footer"} ${position}`}
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
                      <legend>Divider</legend>
                      {PAGE_TEXT_AREAS.map(area => <fieldset key={area} className={styles.dividerRow}>
                        <legend>{area === 'header' ? 'Header' : 'Footer'}</legend>
                        {DIVIDER_SIDES.map(side => <label key={side}>
                          <input type="checkbox" aria-label={`${area} divider ${side}`}
                            checked={headerFooter.divider?.[area][side] ?? false}
                            onChange={event => {
                              const checked = event.target.checked;
                              setHeaderFooter(current => {
                                const divider = current.divider ?? emptyDivider();
                                return { ...current, divider: { ...divider, [area]: { ...divider[area], [side]: checked } } };
                              });
                            }} />
                          {side[0].toUpperCase() + side.slice(1)}
                        </label>)}
                      </fieldset>)}
                      <label>Color
                        <input type="color" aria-label="Header and footer divider color"
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
                    aria-label="Header and footer page preview"
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
                      <strong style={{ color: colors.h1 }}>Chapter One</strong>
                      <p>Your text stays above the background artwork.</p>
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
                                "Sample Book",
                              title: "Chapter One",
                              author: project?.author || "Sample Author",
                              coAuthor:
                                coAuthorNames(project) || "Sample Co-Author",
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
                  Preview uses project credits when available and sample values
                  otherwise. Title and page numbers are examples. Changes are
                  saved only when you save the theme.
                </p>
              </section>

              <p className={styles.description}>
                Preview only: your document changes after Save. Custom CSS
                colors outside six-digit hex values use picker defaults;
                original fonts and layout rules are retained.
              </p>
            </>
          )}

          {!draft && !error && <p role="status">Loading theme…</p>}

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          {busy && <p role="status">{operation}</p>}
        </div>
      </div>

      <footer className={styles.footer}>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>

        {draft?.path && (
          <button type="button" disabled={busy} onClick={() => void save(true)}>
            Save As
          </button>
        )}

        <button
          type="button"
          data-action="save"
          disabled={!draft || busy}
          onClick={() => void save(!draft?.path)}
        >
          {draft?.path ? "Save" : "Save New Theme"}
        </button>
      </footer>
    </section>
  );
}
