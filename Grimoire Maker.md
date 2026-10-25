# Technical Specification: Grimoire Maker

## 1. Visión General del Producto

* **Nombre oficial:** Grimoire Maker
* **Objetivo:** Aplicación de escritorio multiplataforma (Windows, Linux, macOS) ligera, orientada a autores, creadores de rol y Directores de Juego (GMs). Permite redactar, estructurar y maquetar manuales de rol, one-shots, suplementos y libros narrativos con fidelidad visual para imprenta profesional (estilo D&D y publicaciones comerciales), exportando directamente a PDF con paginación real sin requerir software pesado de diseño gráfico ni suscripciones.
* **Filosofía de Almacenamiento:** *Local-first*. La fuente de la verdad son archivos locales de texto plano en Markdown (`.md`) con frontmatter en YAML para metadatos por página, acompañados de directorios locales para assets, configuración del proyecto (`.grimoire-project.json`) y bibliotecas configurables de temas, plantillas y snippets.

---

## 2. Alcance (Scope)

### Dentro del alcance (Implementado)
* **Edición visual en tiempo real (WYSIWYG)** sincronizada bidireccionalmente con archivos Markdown, sobre hojas físicas paginadas visualmente y flujo secuencial de columnas.
* **Espacio de trabajo multipestaña y vista dividida (Split View):** Edición simultánea de múltiples documentos con historial de deshacer independiente y estado de cambios sin guardar por archivo.
* **Vista previa de archivos (Read-only Previews):** Visualización integrada en pestañas para imágenes (PNG, JPEG, GIF, WebP, SVG, BMP, AVIF, ICO), documentos PDF (vía PDF.js local) y archivos Word (`.docx`).
* **Estructura de proyecto tipo Binder:** Organización en carpetas `Draft/`, `Research/` y `Trash/` (papelera suave con movimiento y restauración), creación de proyectos con estructura base e importación segura de archivos externos.
* **Formateo y posicionamiento avanzado de imágenes:** Alineación, flotado (*text wrap* a izquierda/derecha), redimensionado en milímetros, opacidad, marcos decorativos y colocación libre sobre la página (*Over text*) o empujando texto (*Push text*), además de anclajes a cabecera, pie o fondo.
* **Contenedores estándar movibles (`standardContentBox`):** Inserción de snippets de paleta y bloques de plugins dentro de contenedores sin bordes que permiten arrastrar el grupo completo, alternar entre *Push text* y *Over text*, y ajustar ancho/alto en milímetros.
* **Maquetación para imprenta y vista previa Paged.js:** Estándares físicos (A4, Carta/Letter, B5/Digest), vista previa paginada en página única o pliegos enfrentados (*spreads*), sangrado (*bleed*) de 3 mm y marcas de corte.
* **Propiedades de Proyecto y Página:** Metadatos globales por proyecto (`Book name`, `Author`, listas de `Co-Authors` y `Artists` con redes sociales/plataforma) y metadatos por página (`Page title`, override de `1` o `2` columnas).
* **Personalizador de Temas (Theme Customizer):** Edición visual de colores (incluyendo color global de divisores `<hr>`), imágenes decorativas repetibles en cabecera/pie embebidas como `data:` URLs, y plantillas de cabecera/pie con tokens dinámicos (`{book}`, `{title}`, `{author}`, `{coAuthor}`, `{page}`, `{pages}`).
* **Sistema de Mods Declarativos y Mod Manager:** Descubrimiento automático en carpeta `Mods/` (`Templates`, `Snippets`, `Plugins`), importación/exportación de paquetes `.zip` de plantillas, y activación/desactivación persistente en `mods.json`.
* **Regla de imprenta y Guías visuales independientes:** Plugin integrado `Ruler` (medición en mm/px, márgenes y sangrado) y menú `Guides` independiente para añadir/mover guías horizontales y verticales persistentes con soporte de Zoom (`25%`–`300%` y `Ctrl + rueda`).
* **Control de versiones Git local y Auto-commits:** Panel lateral inferior para inicializar repositorio, inspeccionar estado, previsualizar diffs lado a lado (*side-by-side*), hacer stage/unstage, crear commits manuales y configurar **Auto commits** periódicos (`1`–`1440 min`, por defecto `20 min`) con mensaje personalizable.
* **Autoguardado y Registro de Errores (Error Logs):** Autoguardado temporizado configurable (`1 s` a `24 h`), persistencia unificada en `setting.json` con cambio de rutas en caliente, y rotación de logs de diagnóstico (`errors-0001.txt` a `errors-0016.txt`).

### Fuera del alcance (v1.0 / Fase 2)
* Sincronización colaborativa en la nube en tiempo real o ejecución de operaciones Git remotas (`push`/`pull`/`fetch`).
* Carga de plugins ejecutables de terceros desde `Mods/Plugins` (reservado para Fase 2; actualmente solo contenido declarativo Markdown/CSS y plugins compilados integrados).
* Automatizaciones internas de combate o tiradores de dados.

---

## 3. Arquitectura del Sistema y Stack Tecnológico

* **Shell de Escritorio:** **Tauri v2**
  * Backend nativo en **Rust** para acceso seguro al sistema de archivos (`tauri-plugin-fs`, `tauri-plugin-dialog`), migración y custodia de configuración (`%APPDATA%/GriomoireMaker` en Windows), copia atómica de bibliotecas, empaquetado ZIP, ejecución acotada de Git local y rotación de logs de errores.
* **Frontend Core:** **React 19 + TypeScript + Vite 8**
  * Componentes desacoplados, carga diferida (*lazy loading*) para visores pesados (PDF.js, diálogo de preferencias) y suite de pruebas con **Vitest + Testing Library / JSDOM**.
* **Motor del Editor:** **Tiptap v3 (ProseMirror) + `tiptap-markdown`**
  * Extensiones personalizadas para bloques (`statblock`, `read-aloud`, `character-sheet`), tablas GFM editables, nodo de imagen extendido con coordenadas físicas y contenedor agrupado `ContentBox` (`standard-content-box`).
* **Motor de Paginación y Exportación a PDF:**
  * **Paged.js** (`Previewer`) + reglas CSS Paged Media (`@page`, `@page :left`, `@page :right`, sangrado y marcas de corte).
  * **Windows:** Exportación directa a archivo PDF mediante el pipeline nativo de **WebView2** (`PrintToPdf`).
  * **macOS / Linux / Desarrollo web:** Paginación previa con Paged.js seguida del diálogo de impresión del sistema (`window.print()` / *Save to PDF*) con retención controlada del DOM de impresión.
* **Estilos y Maquetación:** **CSS Modules + Tailwind CSS v4**
  * **CSS Modules** para el shell de la aplicación, barra de menús, barras de herramientas, modales y paneles.
  * **Variables CSS** con alcance por `[data-theme='<id>']` para los 4 temas base (`parchment`, `modern`, `dark-fantasy`, `sci-fi`) y temas personalizados.
* **Manejo de Estado Global:** **Zustand v5**
  * Stores especializados: `documentStore` (buffers multipestaña y árbol), `tabStore` (pestañas y *split view*), `explorerStore`, `projectStore` (`.grimoire-project.json`), `settingsStore` (`setting.json`), `sessionStore` (`state.json`), `themeStore`, `templateStore` y `modStore` (`mods.json`).
* **Interacción y Archivos:**
  * **@dnd-kit:** Arrastrar y soltar en el explorador de archivos (mover entre carpetas y hacia `Trash`) y desde la paleta de snippets hacia el lienzo.
  * **fflate & pdfjs-dist:** Validación e inflación segura en memoria de paquetes `.zip` y documentos `.docx`, y renderizado local de páginas PDF en `<canvas>`.

---

## 4. Módulos y Funcionalidades Detalladas

### 4.1. Barra de Menús, Espacio de Trabajo y Pestañas
* **Menú de aplicación (`MenuBar`):**
  * **File:** `New File…` (`Ctrl+N`), `New Project…`, `Open File…` (`Ctrl+O`), `Open Folder…`, `Recent Folders`, `Save`, `Save All` (`Ctrl+S`), `Import…` (hacia `Draft` o `Research` según selección) y `Export PDF…`.
  * **View:** Conmutadores de visibilidad para paneles (`Files`, `Templates`, `Snippets`), `Split View`, `Page View` (con selector de diseño *Single pages* o *Facing pages*), tamaño de página (`A4`, `Letter`, `B5`) y número de columnas global (`1` o `2`).
  * **Settings:** Acceso a `Mod Manager`, `Preferences…`, `About` y `Tutorial`.
* **Multipestaña y Vista Dividida (`DocumentTabs` & `DocumentWorkspace`):**
  * Cada archivo Markdown mantiene su instancia de editor montada, preservando selección, scroll e historial `undo/redo`.
  * Si la pestaña activa no tiene cambios, abrir otro archivo la reemplaza; si está modificada (*dirty*), el nuevo archivo se abre automáticamente en una pestaña nueva. También existe `Open in New Tab` explícito en el menú contextual.
  * **Split View** divide el área central en dos paneles independientes. Seleccionar un documento abierto en el otro panel intercambia sus posiciones.
* **Visores de Solo Lectura (`FilePreview`):**
  * Permite abrir activos de `Draft` o `Research` sin riesgo de sobrescritura: imágenes (ajuste a pantalla o tamaño 100%), PDFs (navegación de páginas y zoom con worker local) y archivos `.docx` (extracción segura de párrafos, estilos básicos y tablas hasta 64 MB).

### 4.2. Lienzo de Edición, Imágenes, Guías y Zoom
* **Hojas físicas y Flujo de Columnas (`PageView`):**
  * El texto fluye secuencialmente llenando la primera columna hasta el margen inferior, pasando a la segunda columna y generando nuevas hojas físicas separadas por `8 mm`.
  * Al hacer clic en los márgenes, cabecera o zonas vacías de la hoja fuera de `.ProseMirror`, el foco se dirige automáticamente al área editable.
* **Control de Imágenes (`ImageControls` & `ImageView`):**
  * Soporta modos *Push text* (con flotado `Wrap · left`, `Wrap · right`, centrado o en línea) y *Over text* (arrastre libre por la hoja con coordenadas `xMm`/`yMm` persistidas en atributos HTML/Markdown), además de anclajes a cabecera, pie y fondo de página, ancho en `mm`, marcos (`simple`, `double`, `shadow`) y opacidad.
* **Regla y Guías Visuales (`pixel-ruler` & `GuidesMenu`):**
  * Botón **Ruler** en la barra superior para mostrar/ocultar reglas graduadas, caja de márgenes y línea de sangrado. Si se activa estando en `Page View`, regresa automáticamente a la vista de edición.
  * Menú **Guides** (junto al botón `Image` en la barra de formato) para añadir guías horizontales (`+ Row`) y verticales (`+ Column`) independientes de la regla, editables por arrastre, teclado (`Flechas` = `1 mm`, `Shift + Flechas` = `10 mm`) o entrada numérica, guardadas en `setting.json`.
* **Zoom de Edición y Previsualización:**
  * Selector de Zoom (`25%` a `300%`) y soporte de `Ctrl + rueda del ratón` tanto en el editor como en `Page View`, manteniendo intactas las medidas físicas en milímetros.

### 4.3. Bloques Preconfigurados y Contenedores Estándar (`ContentBox`)
* **Paleta de Snippets (`SnippetPalette`):**
  * Incluye fichas de personaje con rejillas editables (`character-sheet`), `statblock`, cajas de lectura en voz alta (`read-aloud`) y tablas preconfiguradas de encuentros (`d6`) y botín (`d100`).
* **Estándar `standardContentBox`:**
  * Todo snippet insertado o arrastrado desde la paleta (así como llamadas a `PluginApi.insertContent`) se envuelve automáticamente en un nodo contenedor sin bordes decorativos (`data-type="standard-content-box"`).
  * Al seleccionar cualquier elemento dentro del contenedor aparecen controles locales para mover el bloque completo (**Move**), alternar entre **Push text** y **Over text**, fijar ancho/alto mínimo en `mm` o eliminar el grupo completo en un solo paso de `undo`.

### 4.4. Propiedades de Proyecto, Página y Personalización de Temas
* **Panel `Properties` (bajo Snippets) y `Preferences → Project`:**
  * **Project properties:** `Book name` (sincronizado con el título editable de la barra superior sin renombrar la carpeta en disco), `Author` y modales dedicados para listas de **Co-Author** y **Artist** (`Name | Social media | Platform`), guardados en `.grimoire-project.json`.
  * **Page properties:** `Page title` y selector `Page columns` (`Default`, `1 column`, `2 columns`) guardados en el frontmatter YAML de cada archivo `.md`.
* **Personalizador de Temas (`ThemeCustomizer`):**
  * Secciones dedicadas para **Theme name**, **Colors** (Fondo, Texto, H1, H2, H3, Divider, Accent, Stat block, Read aloud) con vista previa aislada en `iframe` sandboxed, **Backgrounds** (importación y posicionamiento visual de imágenes PNG/JPEG/WebP embebidas en el CSS para repetirse en cada hoja) y **Header and footer** (6 ranuras de texto izquierda/centro/derecha con soporte para `{book}`, `{title}`, `{author}`, `{coAuthor}`, `{page}` y `{pages}`).
  * Instala ejemplos editables (`parchment.css`, `modern.css`, `dark-fantasy.css`, `sci-fi.css`) en `Themes Path` en el primer arranque.

### 4.5. Mods Declarativos, Plantillas y Preferencias
* **Estructura de `Mods/` y `Mod Manager`:**
  * Ubicada por defecto en el directorio de configuración (`%APPDATA%/GriomoireMaker/Mods`), dividida en `Templates/`, `Snippets/` y `Plugins/`.
  * En el primer inicio se siembran los ejemplos oficiales (3 plantillas: `classic-fantasy`, `quick-one-shot`, `a5-zine`; y 5 snippets de D&D) sin sobrescribir ediciones del usuario.
  * El **Mod Manager** permite abrir la carpeta en el explorador del sistema, refrescar el catálogo y activar/desactivar paquetes mediante casillas persistidas en `mods.json`.
* **Paquetes de Plantillas (`.zip` y carpetas):**
  * Soporte para `index.md`, `theme.css` (protegido por `cssGuard.ts` contra `@import` o URLs remotas), `chapters/*.md`, `snippets/*.md` y `assets/*`. Al aplicar una plantilla en un proyecto, se materializa bajo una subcarpeta única `Draft/<template-id>/`.
* **Diálogo de Preferencias (`PreferencesDialog`):**
  * **Appearance:** Selección de tema activo y acceso a `Customize Theme`.
  * **Content folders:** Cambio en caliente (sin reiniciar) de las rutas de `Plugins`, `Snippets`, `Templates`, `Themes` y `Logs`, copiando de forma segura el contenido existente sin sobrescribir archivos de destino.
  * **Shortcuts:** Tabla de referencia de atajos de archivo, edición y zoom.
  * **Auto save:** Configuración del intervalo de autoguardado (por defecto `5 min`) y de **Auto commits** locales (activado por defecto cada `20 min`, intervalo `1`–`1440 min` y mensaje de commit configurable en `setting.json`).
  * **Project:** Acceso rápido a las propiedades y créditos del proyecto activo.

### 4.6. Control de Versiones Git y Diagnóstico
* **Panel `Git · Source control` (`VersionControlPanel` & `GitDiffDialog`):**
  * Indicador visual en la barra lateral cuando existen cambios sin confirmar en disco.
  * Permite inicializar un repositorio Git en la raíz exacta del proyecto, listar archivos en *Staged*, *Changes* y *Untracked*, abrir una vista comparativa lado a lado (*Original* vs *Incoming change*), hacer stage/unstage individual y confirmar cambios (*Commit staged*) ejecutando el binario `git` del sistema de forma aislada (sin shell y desactivando hooks/filtros externos por seguridad).
* **Registro de Errores (`errorLogging.ts` & `error_logs.rs`):**
  * Captura errores no controlados de ventana, promesas rechazadas, `console.error`, errores de tiendas (temas, plantillas, mods, workspace) y fallos nativos de Rust, redactando tokens sensibles comunes y rotando hasta 16 archivos de `1 MiB` (`errors-0001.txt` … `errors-0016.txt`).

---

## 5. Estructura de Carpetas del Proyecto

```text
grimoire-maker/
├── docs/                          # Documentación técnica y funcional por módulo
├── odd/tasks/                     # Registros de especificación y verificación (ODD)
├── src-tauri/                     # Backend nativo en Rust (Tauri v2)
│   ├── capabilities/              # Permisos de ventana y sistema de archivos
│   ├── src/
│   │   ├── main.rs                # Punto de entrada binario
│   │   ├── lib.rs                 # Registro de comandos IPC e inicialización
│   │   ├── config.rs              # Persistencia de estado de sesión (state.json)
│   │   ├── config_root.rs         # Migración y resolución de raíz de configuración
│   │   ├── safe_copy.rs           # Copia atómica sin sobrescritura y validación de enlaces
│   │   ├── commands/              # Comandos IPC expuestos al frontend
│   │   │   ├── archive.rs         # Empaquetado y restauración segura de ZIPs de proyecto
│   │   │   ├── error_logs.rs      # Escritura y rotación de logs de errores
│   │   │   ├── export.rs          # Exportación PDF y ruta de impresión por plataforma
│   │   │   ├── files.rs           # Escaneo del árbol del proyecto
│   │   │   ├── mods.rs            # Apertura segura de carpeta Mods
│   │   │   ├── preferences.rs     # Gestión de setting.json y rutas de bibliotecas
│   │   │   ├── version_control.rs # Comandos Git locales (status, diff, stage, commit, init)
│   │   │   └── workspace.rs       # Gestión de carpetas de trabajo y explorador del SO
│   │   ├── ipc/                   # Tipos base de mensajería IPC
│   │   └── pdf/                   # Pipeline de impresión WebView2 en Windows
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src/                           # Frontend React 19 + TypeScript
│   ├── assets/                    # Iconos SVG y semillas de Mods (Templates y Snippets D&D)
│   ├── components/
│   │   ├── editor/                # Lienzo Tiptap, barra de formato, PageView, PagePreview
│   │   │   └── extensions/        # Nodos ProseMirror (ContentBox, imageNode, tables, blocks)
│   │   ├── layout/                # MenuBar, Toolbar, DocumentTabs, DocumentWorkspace
│   │   ├── mods/                  # Modal ModManager
│   │   ├── project/               # NewProjectDialog y acciones de archivo
│   │   ├── settings/              # PreferencesDialog, ThemeCustomizer, PropertiesPanel, AppInfoDialog
│   │   ├── sidebar/               # FileTree (Binder Draft/Research/Trash) y ResearchPanel
│   │   ├── snippets/              # SnippetPalette arrastrable y definiciones base
│   │   ├── templates/             # TemplateCatalog
│   │   ├── version-control/       # VersionControlPanel y GitDiffDialog (side-by-side)
│   │   └── viewers/               # FilePreview (imágenes, DOCX) y PdfPreview (PDF.js)
│   ├── hooks/                     # useFileSystem, usePrint, useAutoSave, useAutoCommit, useRepositoryStatus, useWheelZoom
│   ├── lib/                       # Lógica de dominio pura (temas, CSS guard, ZIP, DOCX, Git, binder, etc.)
│   ├── plugins/                   # PluginContext, plugin-manager y builtin pixel-ruler + GuidesMenu
│   ├── stores/                    # Stores Zustand (document, tab, explorer, project, settings, theme, mod...)
│   ├── styles/                    # index.css, print.css, page-text.css y temas base
│   ├── types/                     # Contratos TypeScript (document, plugin, ruler)
│   ├── App.tsx
│   └── main.tsx
├── package.json
└── vite.config.ts
```

---

## 6. Estado de Implementación y Pendientes Cerrados

Todos los elementos listados originalmente en la sección *Pending and Bugs* han sido implementados y verificados con pruebas automatizadas:

* [x] **Import Files:** Importación de múltiples archivos a `Draft` o `Research` sin sobrescribir originales (`File → Import…`).
* [x] **Exportación PDF multiplataforma y empaquetado Rust:** Pipeline directo WebView2 en Windows y ruta paginada con diálogo del sistema en macOS/Linux; comandos de archivo en Rust validados.
* [x] **Multi Tab y Split View:** Pestañas independientes con estado preservado, apertura automática en nueva pestaña cuando hay cambios sin guardar, botón `Split View` y renombrado de `Ruler`.
* [x] **Estructura, Estilo y Temas:** Tema `Sci-Fi` incluido, migración del shell a CSS Modules, carpeta `src/assets` con recursos locales y ejemplos de mods, barra de menús superior (`File`, `View`, `Settings`) y agrupación funcional de controles.
* [x] **Control de Versiones Git:** Panel colapsable en la esquina inferior izquierda con indicador de cambios, diff lado a lado, stage/unstage y commits locales.
* [x] **Sistema de Mods y Mod Manager:** Carpeta `Mods` (`Snippets`, `Plugins`, `Templates`) con sembrado automático de ejemplos, recarga al enfocar ventana y `Mod Manager` con persistencia en `mods.json`.
* [x] **Corrección de Bugs y Mejoras adicionales:**
  * Arrastre libre de imágenes (*Over text*) y envoltura de texto (*Push text*) dentro de la hoja.
  * Contenedores movibles sin bordes (`standardContentBox`) para todos los snippets y bloques insertados por plugins.
  * Menú contextual en el explorador con `Open Folder`, `Open Containing Folder`, `Open in New Tab` y `Move to Trash`.
  * Auto-enfoque en el área de escritura al hacer clic en márgenes o zonas vacías de la hoja.
  * Visores integrados de solo lectura para archivos PDF, Word (`.docx`) e imágenes abiertos en pestañas.
  * Personalizador completo de temas (colores, divisor, fondos repetibles, cabeceras/pies con placeholders), guías visuales independientes, zoom con rueda del ratón, autoguardado, propiedades de proyecto/página con listas de créditos y registro rotativo de logs de errores.
