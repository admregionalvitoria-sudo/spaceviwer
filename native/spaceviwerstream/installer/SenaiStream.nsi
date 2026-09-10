Unicode true
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "SenaiStream"
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "..\..\SenaiStream-Setup.exe"
!endif
OutFile "${OUTPUT_FILE}"
InstallDir "$PROGRAMFILES64\SenaiStream"
InstallDirRegKey HKLM "Software\SenaiStream" "InstallDir"

VIProductVersion "0.4.0.0"
VIAddVersionKey "ProductName" "SenaiStream"
VIAddVersionKey "CompanyName" "SenaiStream"
VIAddVersionKey "FileDescription" "SenaiStream Windows Game Streaming Host Setup"
VIAddVersionKey "FileVersion" "0.4.0"
VIAddVersionKey "LegalCopyright" "SenaiStream contributors"

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\SenaiStreamUI.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o painel do SenaiStream"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "SenaiStream" MainSection
  SectionIn RO
  SetShellVarContext all
  SetOutPath "$INSTDIR"

  nsExec::ExecToLog '"$SYSDIR\sc.exe" stop SenaiStream'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" delete SenaiStream'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM SenaiStreamTray.exe /F'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM SenaiStreamUI.exe /F'

  File "..\..\cmake-build-senaistream-persist\SenaiStream.exe"
  File "..\..\cmake-build-senaistream-persist\SenaiStreamTray.exe"
  File "..\..\cmake-build-senaistream-persist\SenaiStreamUI.exe"
  File "..\..\cmake-build-senaistream-persist\WebView2Loader.dll"
  File "..\..\cmake-build-senaistream-persist\SenaiStreamService.exe"
  File "..\..\cmake-build-senaistream-persist\SenaiStreamDisplayCtl.exe"
  File "..\README.md"
  File "..\ARCHITECTURE.md"
  File "..\ARCHITECTURE_NOTES.md"
  File "..\THIRD_PARTY_NOTICES.md"
  File /oname=WebView2-LICENSE.txt "..\third_party\webview2\package\LICENSE.txt"

  SetOutPath "$PLUGINSDIR"
  File "..\third_party\webview2\MicrosoftEdgeWebview2Setup.exe"
  nsExec::ExecToLog '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install'
  SetOutPath "$INSTDIR"

  SetOutPath "$INSTDIR\driver\virtual-display"
  File "..\third_party\virtual_display\package\VirtualDisplayDriver\MttVDD.inf"
  File "..\third_party\virtual_display\package\VirtualDisplayDriver\MttVDD.dll"
  File "..\third_party\virtual_display\package\VirtualDisplayDriver\mttvdd.cat"
  File "..\third_party\virtual_display\package\VirtualDisplayDriver\vdd_settings.xml"
  File /oname=LICENSE.txt "..\third_party\virtual_display\LICENSE.txt"
  SetOutPath "$INSTDIR"

  nsExec::ExecToLog '"$INSTDIR\SenaiStreamDisplayCtl.exe" ensure "$INSTDIR\driver\virtual-display\MttVDD.inf"'
  Pop $0
  ${If} $0 == "3010"
    SetRebootFlag true
  ${ElseIf} $0 != "0"
    MessageBox MB_OK|MB_ICONEXCLAMATION "O host foi instalado, mas o monitor virtual não pôde ser criado (código $0). O SenaiStream continuará funcionando com o monitor físico."
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\SenaiStream" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SenaiStream" "DisplayName" "SenaiStream"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SenaiStream" "DisplayVersion" "0.4.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SenaiStream" "Publisher" "SenaiStream"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SenaiStream" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SenaiStream" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SenaiStream" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\SenaiStream"
  CreateShortcut "$SMPROGRAMS\SenaiStream\Abrir SenaiStream.lnk" "$INSTDIR\SenaiStreamUI.exe"
  CreateShortcut "$SMPROGRAMS\SenaiStream\Desinstalar SenaiStream.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\SenaiStream.lnk" "$INSTDIR\SenaiStreamUI.exe"

  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="SenaiStream TCP"'
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="SenaiStream UDP"'
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="SenaiStream TCP" dir=in action=allow profile=any remoteip=localsubnet protocol=TCP localport=47984,47989,48010 program="$INSTDIR\SenaiStreamTray.exe" enable=yes'
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="SenaiStream UDP" dir=in action=allow profile=any remoteip=localsubnet protocol=UDP localport=47998-48010 program="$INSTDIR\SenaiStreamTray.exe" enable=yes'

  nsExec::ExecToLog '"$SYSDIR\sc.exe" create SenaiStream binPath= "$INSTDIR\SenaiStreamService.exe" start= auto DisplayName= "SenaiStream Host"'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" description SenaiStream "Supervisiona o host interativo SenaiStream para clientes Moonlight."'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" failure SenaiStream reset= 86400 actions= restart/5000/restart/10000/restart/30000'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" start SenaiStream'
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::ExecToLog '"$SYSDIR\sc.exe" stop SenaiStream'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" delete SenaiStream'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM SenaiStreamTray.exe /F'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM SenaiStreamUI.exe /F'
  nsExec::ExecToLog '"$INSTDIR\SenaiStreamDisplayCtl.exe" remove'
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="SenaiStream TCP"'
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="SenaiStream UDP"'
  Delete "$DESKTOP\SenaiStream.lnk"
  RMDir /r "$SMPROGRAMS\SenaiStream"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SenaiStream"
  DeleteRegKey HKLM "Software\SenaiStream"
  RMDir /r "$INSTDIR"
SectionEnd
