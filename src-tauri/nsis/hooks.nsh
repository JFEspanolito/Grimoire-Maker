; Grimoire Maker NSIS installer hooks (included by the Tauri NSIS template, see tauri.conf.json
; bundle.windows.nsis.installerHooks).
;
; What this file adds:
;   * A "Content folders" wizard page (path field + Browse button, default "$DOCUMENTS\Grimoire Maker").
;     This file is included near the top of the generated script, so the page is declared before the
;     template's own pages and appears FIRST in the wizard. It is skipped on upgrades/reinstalls (when
;     "%APPDATA%\GriomoireMaker\setting.json" exists) and in passive/update mode.
;   * After the files are copied (NSIS_HOOK_POSTINSTALL): creates <path>\Plugins, Snippets, Templates,
;     Themes and Logs, and writes the hint file "%APPDATA%\GriomoireMaker\install-content-root.txt"
;     (UTF-16LE with a BOM, one line, the path) that the app reads on its first run.
;   * Silent installs (/S) read "/CONTENTDIR=<path>" and otherwise use "$DOCUMENTS\Grimoire Maker".
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
LangString GmPageText 1033 "Grimoire Maker will create the Plugins, Snippets, Templates, Themes and Logs folders inside this folder. They stay where they are if you uninstall the app."
LangString GmPageText 1034 "Grimoire Maker creará las carpetas Plugins, Snippets, Templates, Themes y Logs dentro de esta carpeta. Se conservan si desinstala la aplicación."
LangString GmBrowse 1033 "Browse..."
LangString GmBrowse 1034 "Examinar..."
LangString GmBrowsePrompt 1033 "Select the folder for your content"
LangString GmBrowsePrompt 1034 "Seleccione la carpeta para su contenido"
LangString GmBadPath 1033 "Enter a full folder path such as C:\Users\you\Documents\Grimoire Maker (or a network path like \\server\share\folder). It cannot contain the characters < > : $\" | ? *"
LangString GmBadPath 1034 "Escriba una ruta completa de carpeta, por ejemplo C:\Users\usted\Documents\Grimoire Maker (o una ruta de red como \\servidor\recurso\carpeta). No puede contener los caracteres < > : $\" | ? *"

Var GmContentDir
Var GmContentEdit
Var GmDirOk

Page custom GmContentPageCreate GmContentPageLeave

; Normalizes and validates $GmContentDir in place. Sets $GmDirOk to 1 when the result is a usable
; absolute path (drive letter or \\server\share), 0 otherwise.
Function GmNormalizeContentDir
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  StrCpy $GmDirOk 0
  StrCpy $R0 $GmContentDir

  ; Trim surrounding spaces.
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

  ; Copy character by character: "/" becomes "\", characters Windows forbids are rejected, and the
  ; drive colon is only accepted at index 1.
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

  ; Drop trailing separators but keep a drive root such as "C:\".
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

  ; No relative segments.
  StrCpy $R6 "$R2\"
  ${StrLoc} $R7 $R6 "\..\" ">"
  ${If} $R7 != ""
    Goto gm_done
  ${EndIf}

  StrCpy $R5 $R2 2
  ${If} $R5 == "\\"
    ; UNC path: \\host\share[\...]
    StrCpy $R6 $R2 "" 2
    StrCpy $R5 $R6 1
    ${If} $R5 == "\"
    ${OrIf} $R5 == ""
      Goto gm_done
    ${EndIf}
    ${StrLoc} $R7 $R6 "\" ">"
    ${If} $R7 == ""
      Goto gm_done
    ${EndIf}
    IntOp $R7 $R7 + 1
    StrCpy $R5 $R6 1 $R7
    ${If} $R5 == ""
    ${OrIf} $R5 == "\"
      Goto gm_done
    ${EndIf}
  ${Else}
    ; Drive path: X:\...
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
      StrCmp $R5 $R6 gm_ok
      IntOp $R3 $R3 + 1
      Goto gm_letter
  ${EndIf}

  gm_ok:
  StrCpy $GmContentDir $R2
  StrCpy $GmDirOk 1

  gm_done:
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
  ; An existing installation keeps its settings: no page.
  ${If} ${FileExists} "$APPDATA\GriomoireMaker\setting.json"
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
    StrCpy $GmContentDir "$DOCUMENTS\Grimoire Maker"
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
Function GmApplyContentDir
  ${If} ${FileExists} "$APPDATA\GriomoireMaker\setting.json"
    DetailPrint "Existing settings found: content folders unchanged."
    Return
  ${EndIf}

  ; No page was shown (silent or passive install): /CONTENTDIR=<path> or the default.
  ${If} $GmContentDir == ""
    ${GetOptions} $CMDLINE "/CONTENTDIR=" $GmContentDir
    ${If} ${Errors}
      StrCpy $GmContentDir ""
    ${EndIf}
    ${If} $GmContentDir == ""
      StrCpy $GmContentDir "$DOCUMENTS\Grimoire Maker"
    ${EndIf}
  ${EndIf}

  Call GmNormalizeContentDir
  ${If} $GmDirOk <> 1
    DetailPrint "Invalid content folder path, the content folders were not created: $GmContentDir"
    SetErrorLevel 2
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_OK "$(GmBadPath)"
    ${EndIf}
    Return
  ${EndIf}

  CreateDirectory "$GmContentDir"
  CreateDirectory "$GmContentDir\Plugins"
  CreateDirectory "$GmContentDir\Snippets"
  CreateDirectory "$GmContentDir\Templates"
  CreateDirectory "$GmContentDir\Themes"
  CreateDirectory "$GmContentDir\Logs"
  ${IfNot} ${FileExists} "$GmContentDir\Logs\*.*"
    DetailPrint "Could not create the content folders in $GmContentDir"
    SetErrorLevel 2
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_OK "Could not create the content folders in $GmContentDir"
    ${EndIf}
    Return
  ${EndIf}

  CreateDirectory "$APPDATA\GriomoireMaker"
  ClearErrors
  FileOpen $0 "$APPDATA\GriomoireMaker\install-content-root.txt" w
  ${IfNot} ${Errors}
    ; UTF-16LE with a byte order mark: correct for accents, enye and Cyrillic user folder names.
    FileWriteUTF16LE /BOM $0 "$GmContentDir"
    FileClose $0
    DetailPrint "Content folders created in $GmContentDir"
  ${Else}
    DetailPrint "Could not write the install-content-root.txt hint."
    SetErrorLevel 2
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  Call GmApplyContentDir
!macroend
