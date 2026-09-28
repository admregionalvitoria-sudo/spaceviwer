## SpaceViewer 2.2.22

- **Sincronização Perfeita de Áudio e Vídeo na TV**:
  - Eliminação da latência e atraso do áudio no modo WebRTC/TV através do uso de renderização de áudio nativa no elemento de vídeo, aproveitando a engine interna de sincronização de relógio RTP/lip-sync do WebRTC.
  - Adicionado suporte a contorno de política de autoplay para navegadores de TV (Smart TVs LG webOS, Samsung Tizen, Android TV).
  - Remoção de filtros DSP lentos (echoCancellation, autoGainControl, noiseSuppression) na captura de áudio da área de trabalho no Host.
- **Painel de Diagnóstico e Instalação de Áudio para TVs (Moonlight)**:
  - Exibição de status em tempo real do driver de áudio virtual (VB-CABLE) no painel de Espelhamento das TVs.
  - Botão de instalação em 1 clique do driver de áudio virtual integrado na interface (`installNativeAudio`).
  - Criação do script executável `INSTALAR_DRIVER_AUDIO.bat` com elevação de privilégios automática como Administrador.
- **Builds Automáticos e Executável (.exe) Sempre Atualizado no GitHub**:
  - Configuração do pipeline GitHub Actions (`.github/workflows/build-and-release.yml`) que compila o instalador Windows (`SpaceViewer-Setup-*.exe`) a cada push na branch principal (`main`), tags e acionamentos manuais, disponibilizando o `.exe` sempre atualizado no GitHub Releases e Artifacts.

## SpaceViewer 2.2.21

- **Cursor do Mouse 100% Visível na Tela Virtual**: Correção definitiva da invisibilidade do ponteiro do mouse ao movê-lo para a tela virtual estendida (`MouseTrails: 2` via chamada da API nativa Win32 `SystemParametersInfo(SPI_SETMOUSETRAILS, ...)`).
- **Composição Via Software no Windows DWM**: O Windows Desktop Window Manager agora renderiza o cursor diretamente no framebuffer da tela virtual, permitindo que a duplicação DXGI capture o cursor em tempo real sem latência.
- **Sincronização Automática e Manual do Cursor**:
  - O cursor do mouse é sincronizado automaticamente ao iniciar o SpaceViewer, ao ativar a tela virtual e ao estabelecer a conexão do host GameStream/Moonlight.
  - Novo botão "Sincronizar Cursor" no painel de Telas para garantia e feedback visual imediato em tempo de execução.
- **Mantida Tela Virtual Única e Áudio Unificado**: Transmissão em tempo real super fluida para todas as TVs e dispositivos conectados.
