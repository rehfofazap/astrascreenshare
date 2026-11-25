; Ganchos do instalador (NSIS do Tauri).
;  - antes de instalar: tira o programa antigo (Electron, até a 2.7.36). Os dados dele ficam
;    (%APPDATA%\AstraScreenShare, com o migracao-dados.json que a versão nova importa);
;  - depois de instalar: "--force-run" (que a atualização do programa manda junto com /S) abre o
;    programa de novo, como o instalador antigo fazia.

!define ASTRA_ELECTRON_UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\06baee7f-9894-57b7-9fa1-953051a6f90f"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R8 HKCU "${ASTRA_ELECTRON_UNINST}" "UninstallString"
  ${If} $R8 != ""
    DetailPrint "Removendo a versão antiga do AstraScreenShare..."
    ExecWait '$R8 /S' $R9
    ; O desinstalador do Electron se copia para a pasta temporária e volta na hora:
    ; espera os arquivos dele saírem (até 30 s).
    StrCpy $R7 0
    ${While} $R7 < 60
      ${IfNot} ${FileExists} "$LOCALAPPDATA\Programs\astra-screenshare\AstraScreenShare.exe"
        ${Break}
      ${EndIf}
      Sleep 500
      IntOp $R7 $R7 + 1
    ${EndWhile}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ClearErrors
  ${GetOptions} $CMDLINE "--force-run" $R6
  ${IfNot} ${Errors}
    ; Já vai abrir pelo /R do próprio Tauri? Então não abre duas vezes.
    ClearErrors
    ${GetOptions} $CMDLINE "/R" $R6
    ${If} ${Errors}
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
    ${EndIf}
  ${EndIf}
!macroend
