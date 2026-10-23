# Technical Specification: Grimoire Maker

## 1. Visión General del Producto

* **Nombre oficial:** Grimoire Maker
* **Objetivo:** Aplicación de escritorio multiplataforma (Windows, Linux, macOS) ligera, orientada a autores, creadores de rol y Directores de Juego (GMs). Permite redactar, estructurar y maquetar manuales de rol, one-shots, suplementos y libros narrativos con fidelidad visual para imprenta profesional (estilo D&D y publicaciones comerciales), exportando directamente a PDF con paginación real sin requerir software pesado de diseño gráfico ni suscripciones.
* **Filosofía de Almacenamiento:** *Local-first*. La fuente de la verdad son archivos locales de texto plano en Markdown (`.md`) con frontmatter en YAML para metadatos, acompañados de directorios locales para assets (imágenes, mapas).

---

## 2. Alcance (Scope)

* **Dentro del alcance:**
* Edición visual en tiempo real (WYSIWYG) sincronizada bidireccionalmente con archivos Markdown.
* Formateo e inserción de imágenes: alineación, flotado (*text wrap*), ajuste de dimensiones y marcos decorativos.
* Maquetación para imprenta basada en estándares físicos (A4, Carta/Letter, B5/Digest, vistas en pliegos/spreads y página única).
* Panel lateral desacoplado para notas de lore, referencias y fichas auxiliares (Research Panel).
* Sistema de bloques preconfigurados arrastrables (*drag & drop snippets*): hojas de personaje, bloques de estadísticas (*statblocks*), cajas de ambientación (*read-aloud boxes*).
* Gestor de plantillas (templates oficiales del sistema y repositorios comunitarios/personalizados).
* Arquitectura modular extensible para plugins mediante IPC nativo o WebSockets.
* Plugin integrado por defecto (Regla visual e inspectora de márgenes/píxeles) como demo técnica documentada.


* **Fuera del alcance (v1.0):**
* Sincronización colaborativa en la nube en tiempo real.
* Automatizaciones internas de combate o tiradores de dados (delegado a futuros plugins de comunidad).



---

## 3. Arquitectura del Sistema y Stack Tecnológico

* **Shell de Escritorio:** **Tauri v2**
* Binarios ligeros (~15 MB) y consumo reducido de RAM (~60-150 MB).
* Backend nativo en **Rust** para gestión del sistema de archivos local, compresión/empaquetado de proyectos y canal IPC seguro.


* **Frontend Core:** **React 19 + TypeScript + Vite**
* Arquitectura de componentes desacoplada, tipado estricto y recarga rápida en desarrollo.


* **Motor del Editor:** **Tiptap (ProseMirror)**
* Soporte de extensiones personalizadas para nodos de bloque complejos (statblocks, cajas decorativas).
* Serialización y deserialización bidireccional entre el estado del documento y Markdown plano con frontmatter.


* **Motor de Paginación y Exportación a PDF:**
* **Paged.js** / CSS Paged Media (`@page`, `@page :left`, `@page :right`, `break-before: page`, marcas de corte y sangrado de 3mm).
* Pipeline de impresión administrado por Tauri/Rust para generar el binario del PDF final respetando dimensiones milimétricas exactas de imprenta.


* **Estilos y Maquetación:** **Tailwind CSS + CSS Modules**
* Variables CSS para tematización dinámica (temas pergamino, fantasía oscura, sci-fi) y control de reglas `@media print`.


* **Manejo de Estado Global:** **Zustand**
* Control del árbol de archivos, estado del buffer de edición, configuración de página activa y registro de plugins.


* **Drag & Drop:** **@dnd-kit**
* Inserción visual de bloques preconfigurados y reordenamiento de elementos en la página.


* **Sistema de Plugins:**
* Protocolo de mensajería vía **Tauri IPC Commands** o WebSockets locales.
* Permite que plugins de terceros (o integraciones desde editores de código externos) inspeccionen el DOM, lean el buffer activo o inyecten contenido sin alterar el código fuente base.



---

## 4. Módulos y Funcionalidades Detalladas

### 4.1. Lienzo de Maquetación y Editor de Texto

* Vista de trabajo con aspecto de hoja física (canvas con paginación virtual configurable en tiempo real).
* Soporte nativo para maquetación a dos columnas con balanceo automático de texto.
* Manejo visual de imágenes: flujo de texto alrededor de la imagen (*wrap text*), anclaje a cabecera, pie o fondo de página con opacidad ajustable.

### 4.2. Sistema de Bloques Preconfigurados (Snippets)

* Panel lateral de componentes preconstruidos listos para arrastrar al documento:
* **Hojas de Personaje:** Plantillas de fichas con rejillas de atributos editables.
* **Statblocks:** Cajas de estadísticas para monstruos, PNJ, hechizos y equipo estilo D&D.
* **Cajas de Ambientación:** Bloques decorativos para texto descriptivo de lectura en voz alta.
* **Tablas de Encuentros / Botín:** Tablas preformateadas listas para completar datos.



### 4.3. Sistema de Plantillas (Templates)

* **Plantillas Oficiales:** Presets incluidos de fábrica (Fantasía Clásica, One-Shot Rápido de 5 páginas, Zine A5 plegado).
* **Plantillas Personalizadas y de Comunidad:** Soporte para importar/exportar paquetes `.zip` o carpetas locales con la siguiente estructura:
* Archivo de estilos base (`theme.css`).
* Estructura inicial de documentos (`index.md`, capítulos auxiliares).
* Colección de snippets propios.



### 4.4. Sistema de Plugins y Modding

* **Runtime de Plugins:** API de eventos para registrar comandos, barras de herramientas personalizadas o paneles laterales.
* **Plugin Demo Integrado (Pixel & Print Ruler):**
* Regla flotante calibrada en píxeles y milímetros sobre el lienzo.
* Lectura de márgenes, sangrados (*bleed*) y guías de corte para control previo al envío a imprenta.
* Código abierto dentro del proyecto como referencia técnica para desarrolladores.



---

## 5. Estructura de Carpetas del Proyecto

```text
grimoire-maker/
├── src-tauri/                     # Backend nativo en Rust
│   ├── src/
│   │   ├── main.rs                # Punto de entrada de Tauri
│   │   ├── commands/              # Comandos IPC (lectura/escritura FS, exportación)
│   │   │   ├── files.rs
│   │   │   └── export.rs
│   │   ├── ipc/                   # Servidor de eventos y comunicación para plugins
│   │   └── pdf/                   # Generación y pipeline de PDF headless
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src/                           # Frontend React + TypeScript
│   ├── assets/                    # Iconos, fuentes y texturas por defecto
│   ├── components/
│   │   ├── editor/                # Core de Tiptap, nodos custom y barra de herramientas
│   │   │   ├── EditorCanvas.tsx
│   │   │   ├── PageView.tsx
│   │   │   └── extensions/        # Nodos custom de ProseMirror (statblock, callout)
│   │   ├── layout/                # Estructura de ventana, barra de menús y estados
│   │   ├── sidebar/               # Árbol de archivos y notas de investigación (Research)
│   │   ├── snippets/              # Paleta de bloques arrastrables (Dnd-kit)
│   │   └── templates/             # Modal y catálogo de plantillas
│   ├── hooks/                     # Custom hooks de React (useFileSystem, usePrint)
│   ├── plugins/                   # Sistema de extensibilidad
│   │   ├── PluginContext.tsx      # Proveedor del ciclo de vida de extensiones
│   │   ├── plugin-manager.ts      # Registro y despacho de hooks de plugins
│   │   └── builtins/              # Plugins nativos incluidos
│   │       └── pixel-ruler/       # Plugin Demo: Regla de medición
│   ├── stores/                    # Estados globales con Zustand
│   │   ├── documentStore.ts
│   │   └── settingsStore.ts
│   ├── styles/                    # Configuración visual
│   │   ├── print.css              # Reglas de Paged.js, @page, sangrados y cortes
│   │   └── themes/                # Temas CSS (pergamino, moderno, dark-fantasy)
│   ├── types/                     # Definiciones de tipos TypeScript
│   │   ├── document.ts
│   │   └── plugin.ts
│   ├── App.tsx
│   └── main.tsx
│
├── package.json
├── tsconfig.json
└── vite.config.ts

```

---

## 6. Hoja de Ruta de Implementación (Next Steps)

1. Ejecutar el scaffolding inicial: `pnpm create tauri-app --template react-ts`.
2. Configurar permisos de sistema de archivos (`fs`) y diálogos (`dialog`) en `tauri.conf.json`.
3. Integrar `@tiptap/react` con serialización a Markdown (`tiptap-markdown`).
4. Implementar el lienzo base con estilos CSS de página física (A4 y Letter) y división en columnas.
5. Desarrollar el componente del primer nodo custom (bloque de estadísticas / statblock) con `@dnd-kit`.