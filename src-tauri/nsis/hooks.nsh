; Grimoire Maker NSIS installer hooks (included by the Tauri NSIS template, see tauri.conf.json
; bundle.windows.nsis.installerHooks).
;
; Interactive installs, including reinstalls, ask for one content root.
; Creates Mods/Plugins, Mods/Snippets, Mods/Templates, Mods/Themes and logs without moving old files.
; An explicit v2 request updates only paths on next startup; legacy hints remain first-run only.
; Silent/passive upgrades preserve paths unless /CONTENTDIR is explicitly provided.
;
; Path rules (GmNormalizeContentDir). They MUST stay identical to the hint validator in
; src-tauri/src/portable.rs (parse_hint), otherwise the app silently ignores the folder the user chose.
; src-tauri/nsis/hint-path-cases.json is checked against both (cargo test and scripts/nsis-hints.test.ts).
;   R1  Surrounding spaces are trimmed; empty or longer than 240 characters is rejected.
;   R2  "/" becomes "\". The characters < > " | ? * and tab, CR, LF are rejected anywhere. A colon is
;       only accepted at index 1 (the drive colon). (The app also rejects other control characters; those
;       cannot be typed into the field and are not mirrored here.)
;   R3  Trailing separators are dropped, but a drive root such as "C:\" is kept.
;   R4  The path must be "X:\..." (X a letter) or "\\host\share[\...]". "C:", "C:dir" and "\dir" are rejected.
;   R5  Every segment (for a network path also host and share) must be non-empty (no "\\" inside the
;       path), must not be "." or "..", must not end with a dot or a space, and its stem (text before the
;       first dot, trailing spaces removed) must not be a Windows device name (list below).
;   R6  A network path needs host and share; a share ending in "$" (administrative share) is rejected.
;       "\\?\" and "\\.\" fail through R2 and R5.
; Comparisons use NSIS "==", which is case-insensitive, like the Rust check on Windows.
;
; The uninstaller is not customised: the content folders, setting.json and the hint files are never
; touched. (The template's optional "Delete app data" checkbox only removes %APPDATA%\<identifier> and
; %LOCALAPPDATA%\<identifier>, never %APPDATA%\GriomoireMaker nor the chosen content folders.)

!include nsDialogs.nsh
!include LogicLib.nsh

; Language ids are numeric because this file is included before the MUI_LANGUAGE lines.
LangString GmPageTitle 1033 "Content folders"
LangString GmPageTitle 1034 "Carpetas de contenido"
LangString GmPageSubtitle 1033 "Choose where Grimoire Maker keeps your content."
LangString GmPageSubtitle 1034 "Elija dónde guarda Grimoire Maker su contenido."
LangString GmPageText 1033 "Creates Mods/Plugins, Mods/Snippets, Mods/Templates, Mods/Themes and logs inside this folder. Existing files are not moved or deleted. Selecting a folder updates the five paths on next launch."
LangString GmPageText 1034 "Crea Mods/Plugins, Mods/Snippets, Mods/Templates, Mods/Themes y logs dentro de esta carpeta. No mueve ni elimina archivos existentes. La selección actualiza las cinco rutas al iniciar la aplicación."
LangString GmBrowse 1033 "Browse..."
LangString GmBrowse 1034 "Examinar..."
LangString GmBrowsePrompt 1033 "Select the folder for your content"
LangString GmBrowsePrompt 1034 "Seleccione la carpeta para su contenido"
LangString GmBadPath 1033 "Enter a full folder path such as C:\Users\you\Documents\Grimoire Maker (or a network path like \\server\share\folder), at most 240 characters.$\r$\n$\r$\nIt cannot contain the characters < > : $\" | ? * (a colon is only allowed after the drive letter), empty parts such as \\ inside the path, parts named . or .., names ending in a dot or a space, Windows device names (CON, NUL, COM1, LPT1...), administrative shares such as \\server\C$$, or invalid Windows paths."
LangString GmBadPath 1034 "Escriba una ruta completa de carpeta, por ejemplo C:\Users\usted\Documents\Grimoire Maker (o una ruta de red como \\servidor\recurso\carpeta), de 240 caracteres como máximo.$\r$\n$\r$\nNo puede contener los caracteres < > : $\" | ? * (los dos puntos solo se permiten tras la letra de la unidad), partes vacías como \\ dentro de la ruta, partes llamadas . o .., nombres que terminen en punto o espacio, nombres de dispositivo de Windows (CON, NUL, COM1, LPT1...), recursos administrativos como \\servidor\C$$."

Var GmContentDir
Var GmContentEdit
Var GmDirOk
Var GmExisting

Page custom GmContentPageCreate GmContentPageLeave

; Sets $GmExisting to 1 when settings of an earlier installation exist (current or legacy file, current or
; pre-rename folder). Unattended upgrades keep these settings unless explicitly overridden.
; The identifier is literal because the template defines BUNDLEID after this file is included.
Function GmDetectExisting
  StrCpy $GmExisting 0
  ${If} ${FileExists} "$APPDATA\GriomoireMaker\setting.json"
  ${OrIf} ${FileExists} "$APPDATA\GriomoireMaker\library-paths.json"
  ${OrIf} ${FileExists} "$APPDATA\app.grimoiremaker.desktop\setting.json"
  ${OrIf} ${FileExists} "$APPDATA\app.grimoiremaker.desktop\library-paths.json"
    StrCpy $GmExisting 1
  ${EndIf}
FunctionEnd

; Normalizes and validates $GmContentDir in place (rules R1-R6 above). Sets $GmDirOk to 1 when the result
; is accepted, 0 otherwise. Registers $R0-$R9 are saved and restored.
Function GmNormalizeContentDir
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $GmDirOk 0
  StrCpy $R0 $GmContentDir

  ; R1: trim surrounding spaces.
  gm_trim_left:
    StrCpy $R1 $R0 1
    StrCmp $R1 " " 0 gm_trim_right
    StrCpy $R0 $R0 "" 1
    Goto gm_trim_left
  gm_trim_right:
    StrCpy $R1 $R0 1 -1
    StrCmp $R1 " " 0 gm_trimmed
    StrCpy $R0 $R0 -1
    Goto gm_trim_right
  gm_trimmed:

  StrLen $R4 $R0
  ${If} $R4 = 0
  ${OrIf} $R4 > 240
    Goto gm_done
  ${EndIf}

  ; R2: copy character by character: "/" becomes "\", forbidden characters are rejected, and the drive
  ; colon is only accepted at index 1.
  StrCpy $R2 ""
  StrCpy $R3 0
  gm_scan:
    ${If} $R3 >= $R4
      Goto gm_scanned
    ${EndIf}
    StrCpy $R5 $R0 1 $R3
    ${If} $R5 == "/"
      StrCpy $R5 "\"
    ${EndIf}
    ${If} $R5 == "<"
    ${OrIf} $R5 == ">"
    ${OrIf} $R5 == "$\""
    ${OrIf} $R5 == "|"
    ${OrIf} $R5 == "?"
    ${OrIf} $R5 == "*"
    ${OrIf} $R5 == "$\t"
    ${OrIf} $R5 == "$\r"
    ${OrIf} $R5 == "$\n"
      Goto gm_done
    ${EndIf}
    ${If} $R5 == ":"
    ${AndIf} $R3 <> 1
      Goto gm_done
    ${EndIf}
    StrCpy $R2 "$R2$R5"
    IntOp $R3 $R3 + 1
    Goto gm_scan
  gm_scanned:

  ; R3: drop trailing separators but keep a drive root such as "C:\".
  gm_strip:
    StrLen $R4 $R2
    ${If} $R4 <= 3
      Goto gm_stripped
    ${EndIf}
    StrCpy $R5 $R2 1 -1
    ${If} $R5 != "\"
      Goto gm_stripped
    ${EndIf}
    StrCpy $R2 $R2 -1
    Goto gm_strip
  gm_stripped:

  ; R4: pick the prefix; $R1 = 1 for a network path, $R8 = the segments after the prefix.
  StrCpy $R5 $R2 2
  ${If} $R5 == "\\"
    StrCpy $R1 1
    StrCpy $R8 $R2 "" 2
  ${Else}
    StrCpy $R1 0
    StrCpy $R5 $R2 1 1
    ${If} $R5 != ":"
      Goto gm_done
    ${EndIf}
    StrCpy $R5 $R2 1 2
    ${If} $R5 != "\"
      Goto gm_done
    ${EndIf}
    StrCpy $R5 $R2 1
    StrCpy $R3 0
    gm_letter:
      StrCpy $R6 "ABCDEFGHIJKLMNOPQRSTUVWXYZ" 1 $R3
      StrCmp $R6 "" gm_done
      StrCmp $R5 $R6 gm_letter_ok
      IntOp $R3 $R3 + 1
      Goto gm_letter
    gm_letter_ok:
    StrCpy $R8 $R2 "" 3
  ${EndIf}

  ; R5/R6: validate every segment. $R6 counts them, $R9 is the current one.
  StrCpy $R6 0
  gm_seg_next:
    StrCmp $R8 "" gm_segs_done
    StrCpy $R9 ""
    StrCpy $R3 0
    gm_seg_scan:
      StrCpy $R5 $R8 1 $R3
      StrCmp $R5 "" gm_seg_cut
      StrCmp $R5 "\" gm_seg_cut
      StrCpy $R9 "$R9$R5"
      IntOp $R3 $R3 + 1
      Goto gm_seg_scan
    gm_seg_cut:
    IntOp $R3 $R3 + 1
    StrLen $R7 $R8
    ${If} $R3 >= $R7
      StrCpy $R8 ""
    ${Else}
      StrCpy $R8 $R8 "" $R3
    ${EndIf}
    IntOp $R6 $R6 + 1

    StrCmp $R9 "" gm_done
    StrCmp $R9 "." gm_done
    StrCmp $R9 ".." gm_done
    StrCpy $R5 $R9 1 -1
    StrCmp $R5 "." gm_done
    StrCmp $R5 " " gm_done
    ; R6: the share of a network path must not be administrative.
    ${If} $R1 = 1
    ${AndIf} $R6 = 2
    ${AndIf} $R5 == "$$"
      Goto gm_done
    ${EndIf}
    ; Stem = text before the first dot, trailing spaces removed.
    StrCpy $R5 ""
    StrCpy $R3 0
    gm_stem:
      StrCpy $R7 $R9 1 $R3
      StrCmp $R7 "" gm_stem_end
      StrCmp $R7 "." gm_stem_end
      StrCpy $R5 "$R5$R7"
      IntOp $R3 $R3 + 1
      Goto gm_stem
    gm_stem_end:
    gm_stem_trim:
      StrCpy $R7 $R5 1 -1
      StrCmp $R7 " " 0 gm_stem_ready
      StrCpy $R5 $R5 -1
      Goto gm_stem_trim
    gm_stem_ready:
    ; GM-DEVICE-NAMES-BEGIN (scripts/nsis-hints.test.ts compares this list with portable.rs)
    ${If} $R5 == "CON"
    ${OrIf} $R5 == "PRN"
    ${OrIf} $R5 == "AUX"
    ${OrIf} $R5 == "NUL"
    ${OrIf} $R5 == "CONIN$$"
    ${OrIf} $R5 == "CONOUT$$"
    ${OrIf} $R5 == "COM1"
    ${OrIf} $R5 == "COM2"
    ${OrIf} $R5 == "COM3"
    ${OrIf} $R5 == "COM4"
    ${OrIf} $R5 == "COM5"
    ${OrIf} $R5 == "COM6"
    ${OrIf} $R5 == "COM7"
    ${OrIf} $R5 == "COM8"
    ${OrIf} $R5 == "COM9"
    ${OrIf} $R5 == "LPT1"
    ${OrIf} $R5 == "LPT2"
    ${OrIf} $R5 == "LPT3"
    ${OrIf} $R5 == "LPT4"
    ${OrIf} $R5 == "LPT5"
    ${OrIf} $R5 == "LPT6"
    ${OrIf} $R5 == "LPT7"
    ${OrIf} $R5 == "LPT8"
    ${OrIf} $R5 == "LPT9"
      Goto gm_done
    ${EndIf}
    ; GM-DEVICE-NAMES-END
    Goto gm_seg_next
  gm_segs_done:

  ; R6: a network path needs a host and a share.
  ${If} $R1 = 1
  ${AndIf} $R6 < 2
    Goto gm_done
  ${EndIf}

  StrCpy $GmContentDir $R2
  StrCpy $GmDirOk 1

  gm_done:
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

; Browse button: the control HWND is on the stack when nsDialogs calls this.
Function GmContentBrowse
  Pop $0
  ${NSD_GetText} $GmContentEdit $0
  nsDialogs::SelectFolderDialog "$(GmBrowsePrompt)" "$0"
  Pop $0
  ${If} $0 != "error"
    ${NSD_SetText} $GmContentEdit $0
  ${EndIf}
FunctionEnd

Function GmPrefillContentDir
  Push $0
  StrCpy $GmContentDir "$APPDATA\GriomoireMaker"
  ClearErrors
  FileOpen $0 "$APPDATA\GriomoireMaker\install-content-root-v2.txt" r
  ${If} ${Errors}
    ClearErrors
    FileOpen $0 "$APPDATA\GriomoireMaker\install-content-root.txt.applied" r
  ${EndIf}
  ${IfNot} ${Errors}
    ; Both records were written by NSIS as UTF-16LE with a BOM.
    FileSeek $0 2 SET
    FileReadUTF16LE $0 $GmContentDir
    FileClose $0
    Call GmNormalizeContentDir
    ${If} $GmDirOk <> 1
      StrCpy $GmContentDir "$APPDATA\GriomoireMaker"
    ${EndIf}
  ${EndIf}
  Pop $0
FunctionEnd

Function GmContentPageCreate
  ; Passive and update installs show no pages.
  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}

  ; This page can be reached after the wizard-style Welcome page hid the header: show it again.
  GetDlgItem $0 $HWNDPARENT 1034
  ShowWindow $0 5
  GetDlgItem $0 $HWNDPARENT 1037
  ShowWindow $0 5
  GetDlgItem $0 $HWNDPARENT 1038
  ShowWindow $0 5
  GetDlgItem $0 $HWNDPARENT 1039
  ShowWindow $0 5
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(GmPageTitle)"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(GmPageSubtitle)"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

  ${If} $GmContentDir == ""
    Call GmPrefillContentDir
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 36u "$(GmPageText)"
  Pop $0
  ${NSD_CreateText} 0 46u 78% 12u "$GmContentDir"
  Pop $GmContentEdit
  ${NSD_CreateButton} 80% 45u 20% 14u "$(GmBrowse)"
  Pop $0
  ${NSD_OnClick} $0 GmContentBrowse

  nsDialogs::Show
FunctionEnd

Function GmContentPageLeave
  ${NSD_GetText} $GmContentEdit $GmContentDir
  Call GmNormalizeContentDir
  ${If} $GmDirOk <> 1
    MessageBox MB_ICONEXCLAMATION|MB_OK "$(GmBadPath)"
    Abort
  ${EndIf}
FunctionEnd

; Creates the content folders and writes the hint file. Failures never abort the install: the app then
; simply starts with its normal defaults; silent installs report exit code 2.
; $0 is saved and restored so the surrounding template code never sees it changed.
Function GmApplyContentDir
  Push $0

  ; Only an explicit unattended override may change an existing installation.
  ${If} $GmContentDir == ""
    ClearErrors
    ${GetOptions} $CMDLINE "/CONTENTDIR=" $GmContentDir
    ${If} ${Errors}
      Call GmDetectExisting
      ${If} $GmExisting = 1
        DetailPrint "Existing settings found: content folders unchanged."
        Goto gm_apply_end
      ${EndIf}
      Call GmPrefillContentDir
    ${EndIf}
  ${EndIf}

  Call GmNormalizeContentDir
  ${If} $GmDirOk <> 1
    DetailPrint "Invalid content folder path, the content folders were not created: $GmContentDir"
    SetErrorLevel 2
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_OK "$(GmBadPath)"
    ${EndIf}
    Goto gm_apply_end
  ${EndIf}

  ClearErrors
  CreateDirectory "$GmContentDir"
  CreateDirectory "$GmContentDir\Mods\Plugins"
  CreateDirectory "$GmContentDir\Mods\Snippets"
  CreateDirectory "$GmContentDir\Mods\Templates"
  CreateDirectory "$GmContentDir\Mods\Themes"
  CreateDirectory "$GmContentDir\logs"
  ${If} ${Errors}
    DetailPrint "Could not create the content folders in $GmContentDir"
    SetErrorLevel 2
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_OK "Could not create the content folders in $GmContentDir"
    ${EndIf}
    Goto gm_apply_end
  ${EndIf}

  CreateDirectory "$APPDATA\GriomoireMaker"
  ClearErrors
  FileOpen $0 "$APPDATA\GriomoireMaker\install-content-root-v2.txt" w
  ${IfNot} ${Errors}
    ; UTF-16LE with a byte order mark: correct for accents, enye and Cyrillic user folder names.
    FileWriteUTF16LE /BOM $0 "$GmContentDir"
    FileClose $0
    DetailPrint "Content folders created in $GmContentDir"
  ${Else}
    DetailPrint "Could not write the install-content-root-v2.txt hint."
    SetErrorLevel 2
  ${EndIf}

  gm_apply_end:
  Pop $0
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  Call GmApplyContentDir
!macroend
