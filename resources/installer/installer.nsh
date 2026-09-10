# SpaceViewer v2.2.14
# ============================================================
# SpaceViewer — NSIS Custom Install Actions
# Writes the install-mode.json based on installer selection.
# ============================================================

!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
  Var Dialog
  Var Label
  Var RadioMaster
  Var RadioAgent
  Var RadioBoth
  Var SelectedMode
!endif

!macro customInit
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "admin"
    # Auto-elevar com UAC para garantir instalacao dos drivers de video virtual
    ExecShell "runas" "$EXEPATH" "$CMDLINE"
    Quit
  ${EndIf}

  # Fechar instancias ativas do SpaceViewer e SpaceviwerStream para permitir atualizacao in-place sem travar arquivos
  nsExec::Exec 'taskkill /F /IM SpaceViewer.exe /T'
  nsExec::Exec 'taskkill /F /IM SpaceviwerStream.exe /T'
  nsExec::Exec 'taskkill /F /IM SpaceviwerStreamDisplayCtl.exe /T'

  !ifndef BUILD_UNINSTALLER
    StrCpy $SelectedMode "both"
  !endif
!macroend

!macro customUnInit
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "admin"
    ExecShell "runas" "$EXEPATH"
    Quit
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  !ifndef BUILD_UNINSTALLER
    Page custom showInstallModePage leaveInstallModePage
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
Function showInstallModePage
  nsDialogs::Create 1018
  Pop $Dialog

  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Selecione o modo de instalacao do SpaceViewer. O Agente sera executado em segundo plano e podera ser controlado pela barra de tarefas."
  Pop $Label

  ${NSD_CreateRadioButton} 10u 30u 80% 15u "Instalar Master + Agente (Recomendado - permite transmitir e receber)"
  Pop $RadioBoth
  ${NSD_Check} $RadioBoth

  ${NSD_CreateRadioButton} 10u 50u 80% 15u "Instalar apenas o Master (Computador principal que transmite a tela)"
  Pop $RadioMaster

  ${NSD_CreateRadioButton} 10u 70u 80% 15u "Instalar apenas o Agente (Dispositivo que servira como tela secundaria)"
  Pop $RadioAgent

  nsDialogs::Show
FunctionEnd

Function leaveInstallModePage
  ${NSD_GetState} $RadioMaster $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $SelectedMode "master"
  ${Else}
    ${NSD_GetState} $RadioAgent $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $SelectedMode "agent"
    ${Else}
      StrCpy $SelectedMode "both"
    ${EndIf}
  ${EndIf}
FunctionEnd
!endif

!macro customInstall
  CreateDirectory "$APPDATA\SpaceViewer"
  FileOpen $0 "$APPDATA\SpaceViewer\install-mode.json" "w"
  
  # Ensure SelectedMode is not empty (for silent installs)
  !ifndef BUILD_UNINSTALLER
    ${If} $SelectedMode == ""
      StrCpy $SelectedMode "both"
    ${EndIf}
    FileWrite $0 '{"mode":"$SelectedMode"}'
  !else
    FileWrite $0 '{"mode":"both"}'
  !endif
  
  FileClose $0

  # Monitor creation is controlled by the interface and preserves the user's count.
  # Stop the superseded standalone host so the integrated server can bind its ports.
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\spaceviwerstream\migrate-host.ps1"'

  # Configurar regras de Firewall para GameStream, Descoberta Multicast e SpaceViewer
  DetailPrint "Configurando regras de firewall para descoberta de rede e Moonlight..."
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer SpaceviwerStream TCP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer SpaceviwerStream UDP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer App TCP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer App UDP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer GameStream Ports TCP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer GameStream Ports UDP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer Discovery UDP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer WebRTC TCP"'

  # Liberar executavel principal SpaceViewer
  nsExec::Exec 'netsh advfirewall firewall add rule name="SpaceViewer App TCP" dir=in action=allow profile=any program="$INSTDIR\SpaceViewer.exe" enable=yes'
  nsExec::Exec 'netsh advfirewall firewall add rule name="SpaceViewer App UDP" dir=in action=allow profile=any program="$INSTDIR\SpaceViewer.exe" enable=yes'

  # Liberar portas do SpaceviwerStream (GameStream para Moonlight)
  ${If} ${FileExists} "$INSTDIR\resources\spaceviwerstream\SpaceviwerStream.exe"
    nsExec::Exec 'netsh advfirewall firewall add rule name="SpaceViewer SpaceviwerStream TCP" dir=in action=allow profile=any protocol=TCP localport=47984-48010 program="$INSTDIR\resources\spaceviwerstream\SpaceviwerStream.exe" enable=yes'
    nsExec::Exec 'netsh advfirewall firewall add rule name="SpaceViewer SpaceviwerStream UDP" dir=in action=allow profile=any protocol=UDP localport=47984-48010 program="$INSTDIR\resources\spaceviwerstream\SpaceviwerStream.exe" enable=yes'
  ${EndIf}
  nsExec::Exec 'netsh advfirewall firewall add rule name="SpaceViewer GameStream Ports TCP" dir=in action=allow profile=any protocol=TCP localport=47984-48010 enable=yes'
  nsExec::Exec 'netsh advfirewall firewall add rule name="SpaceViewer GameStream Ports UDP" dir=in action=allow profile=any protocol=UDP localport=47984-48010 enable=yes'

  # Liberar portas de descoberta mDNS (5353) e SSDP (1900)
  nsExec::Exec 'netsh advfirewall firewall add rule name="SpaceViewer Discovery UDP" dir=in action=allow profile=any protocol=UDP localport=5353,1900 enable=yes'

  # Liberar portas WebRTC LAN (7523 e 7524)
  nsExec::Exec 'netsh advfirewall firewall add rule name="SpaceViewer WebRTC TCP" dir=in action=allow profile=any protocol=TCP localport=7523,7524 enable=yes'

  # Configurar perfil de rede como Particular (Privada) e habilitar servicos de descoberta
  DetailPrint "Habilitando descoberta de rede e configurando perfil privado..."
  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetConnectionProfile | Where-Object { $$_.NetworkCategory -eq \"Public\" } | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue"'
  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Service FDResPub, FDPHost, SSDPSRV, upnphost -ErrorAction SilentlyContinue"'
!macroend

!macro customUnInstall
  ${If} ${FileExists} "$INSTDIR\resources\spaceviwerstream\display-manager.ps1"
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\spaceviwerstream\display-manager.ps1" -Action remove'
  ${EndIf}
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer SpaceviwerStream TCP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer SpaceviwerStream UDP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer App TCP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer App UDP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer Discovery UDP"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SpaceViewer WebRTC TCP"'
!macroend
