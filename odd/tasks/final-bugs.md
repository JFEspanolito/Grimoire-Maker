Objective: fix the three bugs listed under section 7 of Grimoire Maker.md after template packages. Branch: fix/final-bugs. Delivery: no PR. Test runner: pnpm test, pnpm build, pnpm lint, cargo test for Rust changes.

## Specs
- S1: "No puedo arrastrar las imagenes para colocarlas donde yo quiera dentro de la hoja". Image placement must remain inside the physical page and survive Markdown reload.
- S2: "No puedo hacer clic derecho open folder en el file explorer". A folder context menu must offer opening that directory in the system file explorer.
- S3: "Al dar clic en la hoja sobre el borde, header, o cualquier zona fuera de [blue box] que muestra la ruler (la zona donde se edita), el sistema lo detecta como \"nada\", y aparenta dar a entender al usuario qué no puede editar su texto... si dar clic fuera del margen azul dentro de la page, que auto focus en la zona donde sí puedo escribir." The editable area must receive focus from a click on the sheet outside its content region.

## Tasks
- T1 | S2 | inline | done | commit: pending | Open folder from the explorer context menu through a bounded native command
- T2 | S3 | inline | pending | commit: - | Focus the editable content from non-content page clicks
- T3 | S1 | inline | pending | commit: - | Drag free-positioned images within the sheet and round-trip position
- T4 | S1-S3 | inline | pending | commit: - | Focused integration checks and observed bug corrections

## Log
- L1 (2026-10-23): "luego bugs, al final". The user concurrently added the three quoted bugs to Grimoire Maker.md; this task follows the completed template feature and does not edit that user-owned file.
- L2: Route is inline: the three bugs are sequential and touch shared editor surfaces. Engram mirror pending because no registered runtime session identity is available. Review mode remains disabled at the user's request.
- L3: T1 RED: Rust helper did not exist and FileTree lacked "Open Folder"; GREEN: 1 focused Rust test and 5 FileTree tests passed, `pnpm build` passed. The native command canonicalizes the active workspace and target before launching the OS file explorer without a shell; the window interaction was not driven.
