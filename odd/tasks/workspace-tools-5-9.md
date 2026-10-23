Objective: implement pending items 5 through 9. Branch: feat/workspace-tools-5-9. Delivery: exactly one commit per pending item, no push or PR. Test runner: Vitest, TypeScript/Vite, oxlint, Rust unit tests.
User explicitly requests one commit per item; larger coherent items remain single commits rather than artificial line-count slices. Engram mirror unavailable: runtime session registration is absent.

## Specs
- S5: "Import Files: Permitir importar archivos tanto en Draft como Research)". Copy selected local files into the chosen binder section without replacing existing files or modifying sources.
- S6: "Rust: compresión y empaquetado de proyectos; la exportación PDF solo existe en Windows.". Rust project zip packing/unpacking; provide a non-Windows PDF route with explicit platform behavior.
- S7: "Multi Tab: Permitir tener más de 1 archivo abierto, en pestañas independientes." "Añadir un botón arriba derecha a lado de \"Toggle Print Ruler\" para doble vista, es decir, 2 pestañas en paralelo abiertas en 2 vistas independientes." "Renombrar \"Toggle Print Ruler\" por \"Ruler\"." Independent document state and two editable panes, with no lost unsaved edits.
- S8: "Falta el tema sci-fi (se puede hacer como mod)." "No se usan CSS Modules, solo Tailwind." "Falta src/assets." "No hay barra de menús." "Agrupar barras, menús, botones, por función." Add a sci-fi theme, real assets, scoped shell styles, application menus and functional grouping without replacing content/print CSS.
- S9: "Añadir una sección pequeña como tab o algo inferior izquierda, que permita usar git como control de versiones (como hace vscode que tenemos un panel para ver cambios y hacer commits)." Local-only source-control panel with changes, diff, staging and explicit commits; no remote operations or destructive reset.

## Tasks
- T5 | S5 | inline | pending | commit: - | Binder file import and regression tests
- T6 | S6 | delegated direct | pending | commit: - | Project archive/PDF unit; independent Rust/PDF surfaces parallel with T9
- T7 | S7 | inline | pending | commit: - | Independent documents and split editor
- T8 | S8 | inline | pending | commit: - | Theme, assets, CSS Modules, menus and shell grouping
- T9 | S9 | delegated direct | pending | commit: - | Local Git panel/native unit; independent surfaces parallel with T6

## Log
- L1: "Ejecuta del 5 al 9, 1 commit, por pendiente."
- L2: Initial tree clean at 2219975 (user committed the requirements document). Native review remains disabled per user instruction; ordinary functional checks remain. No runtime session ID exists, so memory writes are forbidden.
- L3: Writer trigger: T6 and T9 are independent behavior units with disjoint native modules and UI directories. Parent owns shared registration files, App, Toolbar, git staging and commits. The configured gpt-6.1-luna worker model is not exposed in this session; workers use the available inherited model instead.
