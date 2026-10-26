## SpaceViewer 2.2.26

- **Correção Definitiva de Exceção ao Conectar no Transmissor (`Cannot read properties of undefined (reading 'latency')`)**:
  - Inicialização segura de métricas de desempenho (`metrics`: latency, fps, bandwidth, packetsLost, jitter) em todos os agentes no momento da conexão pelo servidor de sinalização e no armazenamento central (`masterStore`).
  - Blindagem completa com encadeamento opcional (`agent.metrics?.latency`) e fallback para 0 no painel de monitoramento de rede (`NetworkMonitor.tsx`), no dashboard de agentes (`Dashboard.tsx`) e na listagem detalhada (`AgentsList.tsx`).
  - Proteção em `AgentView.tsx` e `MasterApp.tsx` para garantir estabilidade contínua durante o streaming WebRTC.

## SpaceViewer 2.2.25

- **Prevenção Definitiva da Tela Branca (React ErrorBoundary & Safe Renderer)**:
  - Adicionado componente global `ErrorBoundary` que impede que falhas de renderização desmontem o aplicativo em uma tela sólida branca, exibindo cartão de diagnóstico e botões de recuperação.
  - Correção de erro `ReferenceError: process is not defined` no modo Agente (`AgentApp.tsx`) ao conectar a um transmissor/master.
  - Proteção contra valores nulos/indefinidos em `TVAssignments.tsx` durante transições de sessões de vídeo e telas.
  - Novos atalhos de depuração e recuperação no aplicativo Electron: `F5` / `Ctrl+R` para recarregar a interface e `F12` / `Ctrl+Shift+I` para alternar o DevTools.
  - Recuperação automática caso o processo de renderização do Chromium seja finalizado ou reiniciado pelo sistema (`render-process-gone`).

## SpaceViewer 2.2.24

- **Correção de Exceção de Rede mDNS / Bonjour (EADDRNOTAVAIL 224.0.0.251:5353)**:
  - Proteção completa do socket UDP de autodescoberta com supressão de erros assíncronos e callbacks seguros em `patchBonjourService` e `createSafeBonjour`.
  - Configuração de `reuseAddr: true` sem amarras a IPs voláteis, prevenindo erros ao alternar conexões Wi-Fi ou interfaces de rede.
  - Callbacks seguros no envio de mensagens de descoberta SSDP em `TVDiscovery` e no reanúncio mDNS.
  - Escudo global no processo principal do Electron (`uncaughtException` e `unhandledRejection`) para isolar falhas transitórias de sockets UDP de rede.

## SpaceViewer 2.2.23

- **Otimização de Desempenho e Reutilização de Buffer NV12**:
  - Reutilização da alocação de memória do buffer NV12 no loop de captura ao vivo em `video_recorder.cpp`, eliminando alocações repetitivas de buffers por quadro e reduzindo a sobrecarga de CPU/GC.
- **Estabilidade de Transmissão em Redes Wi-Fi**:
  - Ajuste do bitrate padrão de transmissão para 20 Mbps (otimizado para streaming 1080p a 60 FPS em Wi-Fi), reduzindo o congestionamento e instabilidade da rede sem fio.
  - Novas orientações no painel do Moonlight recomendando redes de 5 GHz / 6 GHz e redução preventiva para 15 Mbps caso a TV apresente engasgos.
- **Instalação Integrada do VB-CABLE**:
  - O pacote oficial, fixado por SHA-256 durante o build, é incluído no instalador Windows e pode ser instalado durante o setup, sem download no computador do usuário.
  - O driver permanece opcional; a tela de instalação informa a origem VB-Audio, o modelo donationware e o link de licenciamento.
  - O botão de instalação manual reutiliza o pacote integrado e evita exibir saída CLIXML do PowerShell como erro.

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
