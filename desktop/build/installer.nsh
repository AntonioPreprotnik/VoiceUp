; Included by electron-builder (nsis.include in electron-builder.yml).
; APP_FILENAME is VoiceUp, which is also the folder Electron uses for userData (the
; package name, voiceup: Windows ignores the case). It holds settings, models and logs.
!macro customUnInstall
  ; An update or reinstall runs this uninstaller too, and must keep the user's data.
  ; A silent uninstall has nobody to ask, so it keeps the data as well.
  ${ifNot} ${isUpdated}
    ${if} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your VoiceUp settings, downloaded speech models and logs?$\r$\n$\r$\nChoose No to keep them for a later install." /SD IDNO IDYES`
      RMDir /r "$APPDATA\${APP_FILENAME}"
    ${endIf}
  ${endIf}
!macroend
