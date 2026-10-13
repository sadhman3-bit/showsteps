; ShowSteps installer hooks (per-user NSIS from electron-builder).
; Install: the app registers its Chrome/Edge native messaging host for this user.
; Uninstall: remove those registry keys and the host manifest. Guides are left in place.

!macro customInstall
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --register-native-host'
!macroend

!macro customUnInstall
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --unregister-native-host'
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.showsteps.host"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.showsteps.host"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.showsteps.host"
  ; The host's name before the rename (the app also removes these when it registers).
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.trailmark.host"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.trailmark.host"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.trailmark.host"
  Delete "$APPDATA\ShowSteps\com.showsteps.host.json"
!macroend
