## SpaceViewer 2.2.21

- **Cursor do Mouse 100% Visível na Tela Virtual**: Correção definitiva da invisibilidade do ponteiro do mouse ao movê-lo para a tela virtual estendida (`MouseTrails: 2` via chamada da API nativa Win32 `SystemParametersInfo(SPI_SETMOUSETRAILS, ...)`).
- **Composição Via Software no Windows DWM**: O Windows Desktop Window Manager agora renderiza o cursor diretamente no framebuffer da tela virtual, permitindo que a duplicação DXGI capture o cursor em tempo real sem latência.
- **Sincronização Automática e Manual do Cursor**:
  - O cursor do mouse é sincronizado automaticamente ao iniciar o SpaceViewer, ao ativar a tela virtual e ao estabelecer a conexão do host GameStream/Moonlight.
  - Novo botão "Sincronizar Cursor" no painel de Telas para garantia e feedback visual imediato em tempo de execução.
- **Mantida Tela Virtual Única e Áudio Unificado**: Transmissão em tempo real super fluida para todas as TVs e dispositivos conectados.
