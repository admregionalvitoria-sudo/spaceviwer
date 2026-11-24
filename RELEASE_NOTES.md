## SpaceViewer 3.2.1

- **WebRTC como modo de transmissão padrão**:
  - Definido o transporte **WebRTC** como padrão em **Opções → Telas sem fio** (incluindo migração automática única de instalações anteriores), preservando qualidade de vídeo e fluidez na rede local.
  - O modo Tempo Real Nativo (GPU / TCP 47813) continua disponível para seleção manual nas Opções.
- **Recuperação automática contra travamento de imagem na TV (APK e PC)**:
  - No APK **SpaceViewer Display**: detector de travamento de vídeo/decodificador em WebRTC (`webrtc-recover`), correção no fallback de reprodução ao desbloquear áudio, retomada automática de `<video>` pausado, monitoramento de queda de ICE e timeout de ping/pong do WebSocket.
  - No PC: reinício automático da sessão WebRTC em caso de queda ICE, encerramento da captura ou solicitação de recuperação pela TV, além de limpeza de WebSockets sem resposta.
  - No modo Tempo Real Nativo: proteção contra socket TCP travado (`setSoTimeout`), correção de condição de corrida ao reconectar no `StreamServer`, recuperação automática do `MediaCodec` em falhas e detecção de travamento do encoder no PC.

## SpaceViewer 3.2.0

- **Controle de congestionamento pelo atraso real da rede (RTT)**:
  - O atraso é monitorado através de PING/PONG a cada 200 ms no mesmo socket TCP, detectando acúmulo na fila de envio do Windows antes que cause travamento.
  - Descarte seguro com histerese: entra em modo de descarte quando o atraso de fila ultrapassa 80 ms ou a fila local excede 1,5 quadro; sai apenas quando o atraso cai abaixo de 30 ms e o buffer esvazia.
  - Áudio protegido: descartado somente em congestionamento extremo (atraso > 300 ms).
- **Atualização intra (Intra Refresh) sem travar à espera de quadro-chave**:
  - Os encoders NVENC e QuickSync utilizam atualização intra periódica (`intra-refresh`), permitindo que o fluxo se recupere instantaneamente de qualquer perda sem necessidade de esperar por quadros IDR periódicos.
  - O decodificador Android descarta os quadros mais antigos mantendo os mais recentes sem travar à espera de keyframe.
- **Bitrate adaptativo e banda total dividida entre as TVs**:
  - Nova opção global de "Banda total para todas as TVs" (10, 15, 20 Mbps padrão, 30 e 50 Mbps), dividida automaticamente entre os aparelhos conectados para estabilidade em redes Wi-Fi fracas.
  - Redução automática de 30% no bitrate ao detectar congestionamento persistente (mínimo de 1,5 Mbps) e recuperação gradual de 15% após 20 s de rede estável.
  - Reinicialização a quente do codificador sem interrupção de vídeo e sem recriar o MediaCodec no Android.
- **Registro de diagnóstico**:
  - Diagnóstico contínuo e não-bloqueante gravado em `%ProgramData%\SpaceViewer\logs\spaceviewer.log` com rotação de 5 MB.
  - Botão "Abrir pasta de diagnóstico" nas Opções do aplicativo.
- **Obrigatoriedade do APK 3.2.0**:
  - O aplicativo SpaceViewer Display no aparelho receptor Android deve ser atualizado para a versão 3.2.0 para suporte ao Intra Refresh e métricas de intervalo de renderização.

## SpaceViewer 3.1.1

- 30 e 60 fps disponíveis em todas as qualidades (Economia, Equilibrado, Alta, Ultra e Nativa): em Opções > Telas sem fio para todos os aparelhos e em Telas > Quadros por segundo para cada aparelho.
- A 30 fps o bitrate é reduzido automaticamente (cerca de 1/3 menos banda), mantendo a resolução.
- A qualidade Nativa passa a seguir o fps escolhido (até 60), em vez de usar 90/120 Hz da tela do aparelho.
- O APK não mudou: a versão 3.1.0 instalada na TV continua valendo.

## SpaceViewer 3.1.0

- **Modo Tempo Real Nativo (latência ultrabaixa estilo Moonlight/spacedesk)**:
  - **Captura e codificação na GPU do PC**: captura direta acelerada por hardware via Windows Graphics Capture (`gfxcapture`) e codificação H.264 de ultrabaixa latência através dos encoders de hardware NVENC (NVIDIA), QuickSync (Intel) ou Media Foundation (AMD/genérico).
  - **Decodificação de baixa latência no aparelho (`MediaCodec`)**: decodificação por hardware direta em `SurfaceView` no Android com ativação de chaves de baixa latência dos fabricantes (`KEY_LOW_LATENCY`), descartando acúmulos de buffer em rajadas de rede.
  - **Áudio PCM não compactado**: captura direta do áudio loopback do sistema via `AudioWorklet` no PC e reprodução de baixa latência no Android via `AudioTrack` em modo `PERFORMANCE_MODE_LOW_LATENCY`.
  - **Protocolo de fluxo dedicado (TCP 47813)**: comunicação direta por socket com enquadramento binário de 12 bytes, controle de contrapressão inteligente (descarte seguro de quadros P até o próximo keyframe em caso de saturação) e medição de RTT em tempo real.
- **Modo Compatível (WebRTC) como reserva automática**:
  - Caso o computador não possua codificadores de hardware compatíveis ou o aparelho receptor não possua a capacidade nativa, o SpaceViewer alterna de forma transparente para o transporte WebRTC ("Compatível") sem travar a interface.
  - Seletor de "Modo de transmissão" disponível nas opções de qualidade de tela.
- **Overlay de estatísticas no receptor e no PC**:
  - Toque duplo na tela do aparelho receptor Android alterna a exibição de métricas em tempo real (`fps · decode ms · fila · descartes · codec`).
  - No PC, os cards de monitor exibem o status detalhado da sessão (`Tempo real · <encoder> → <decoder>` ou `Compatível (WebRTC)`).
- **Obrigatoriedade de atualização do APK**:
  - O aplicativo SpaceViewer Display no aparelho receptor deve ser atualizado para a versão 3.1.0 para suporte ao modo nativo em tempo real.

## SpaceViewer 3.0.5

- **Redução drástica de atraso (delay) do mouse na tela estendida**:
  - Remoção de rastros forçados de mouse (`MouseTrails`), eliminando o efeito fantasma e atraso artificial de ponteiro na segunda tela. Novo botão para restaurar o cursor normal nas opções de tela.
  - O Chromium e o processo de captura não são mais desacelerados quando a janela do SpaceViewer está oculta, minimizada ou em segundo plano (`disable-renderer-backgrounding`, `disable-background-timer-throttling`, `CalculateNativeWinOcclusion` desativado e prioridade de processo elevada).
  - Predefinição Economia ajustada para 720p @ 60 fps (5 Mbps) e prioridade padrão alterada para Fluidez (menor atraso do mouse e taxa de quadros sustentada). Rampa inicial de bitrate WebRTC acelerada (80% inicial / 30% mínimo).
- **Wi-Fi de baixa latência e menor atraso de reprodução no Android**:
  - O aplicativo SpaceViewer Display no Android agora ativa bloqueio de Wi-Fi de baixa latência (`WIFI_MODE_FULL_LOW_LATENCY` no Android 10+ / `WIFI_MODE_FULL_HIGH_PERF`) durante a transmissão e zera o alvo do jitter buffer (`jitterBufferTarget = 0`).
  - O APK deve ser atualizado para a versão 3.0.5 para ativar o modo de Wi-Fi de baixa latência.
  - Indicador e métrica de tempo de buffer em milissegundos exibidos no painel do PC e no overlay de estatísticas do aparelho.

## SpaceViewer 3.0.4

- Corrigido o erro `O Windows recusou a alteracao de \\.\DISPLAYn (codigo -2)` ao estender: a tela estendida agora usa um modo que o driver anuncia (o mais próximo da resolução do aparelho) e, se o Windows ainda recusar, liga a tela pela topologia do Windows (como em Configurações > Tela > Estender), mantendo desligadas as outras saídas virtuais.
- Mensagens de erro do driver sem caracteres corrompidos.

## SpaceViewer 3.0.3

- Corrigido o falso erro `PnPUtil falhou (codigo 259)` ao instalar o driver de tela estendida quando ele já estava no Windows.
- Reinstalar o driver agora reinicia o adaptador existente para ativar as 4 saídas de tela estendida.
- O app detecta a Área de Trabalho Remota e explica que o Windows não mostra telas estendidas nessa sessão (Duplicar continua funcionando).

## SpaceViewer 3.0.2

- **Execução sempre como administrador e instalação para todos os usuários**: o aplicativo agora solicita privilégios elevados nativamente (`requireAdministrator`) e compartilha a configuração da máquina em `C:\ProgramData\SpaceViewer\install-mode.json`, permitindo que todos os usuários do computador utilizem o SpaceViewer sem conflitos de permissões.
- **Inicialização com o Windows via Tarefa Agendada**: o início automático com o sistema agora é configurado através do Agendador de Tarefas do Windows (`schtasks`), garantindo inicialização correta com privilégios administrativos no logon.
- **Áudio do computador no aparelho receptor**: transmissão do som do PC em estéreo (Opus) no mesmo canal WebRTC do vídeo. Permite ativar ou desativar globalmente e por aparelho, com qualidade ajustável (96, 128, 192 ou 256 kbps). O app no aparelho receptor deve ser atualizado para a versão 3.0.2 para reprodução de áudio.
- **Controle de volume pelo hardware**: as teclas físicas de volume dos aparelhos Android agora controlam diretamente o volume da transmissão.

## SpaceViewer 3.0.1

- **Modo Estender sem elevação administrativa no uso**: o driver de vídeo é instalado uma única vez durante a instalação ou pelo botão no aplicativo (com privilégios de administrador). Ao conectar um aparelho em Estender, um novo monitor do Windows é criado e anexado imediatamente à direita dos demais na resolução do aparelho, sem prompts de UAC.
- **Ciclo dinâmico de telas estendidas**: ao desconectar um aparelho, o monitor correspondente é removido do Windows automaticamente (a menos que a opção "Manter o monitor estendido ao desconectar" esteja ativada).
- **Interface simplificada**: remoção dos botões de estender/duplicar do Windows da barra superior e do contador de telas virtuais; o mapa de telas agora identifica monitores estendidos diretamente com o nome do aparelho conectado.

## SpaceViewer 3.0.0

- **Telas sem fio no Android**: novo app **SpaceViewer Display** (APK, pasta `android/`) transforma tablets e celulares em telas extras do PC. O app só mostra host/IP e recebe o vídeo; toda a configuração fica no executável.
- **Estender ou duplicar por aparelho**: cada aparelho em modo Estender ganha a própria tela virtual (até 4) na resolução escolhida; em modo Duplicar, espelha o monitor escolhido. Ações em massa: Estender/Duplicar todas ou só as selecionadas, e Desconectar todas.
- **Busca na rede**: botão Buscar (UDP 47810/47812 + mDNS), adicionar por IP e QR code para instalar o APK direto do PC.
- **Controle dos monitores do PC** na primeira tela: mapa com posição real, resolução e Hz, tornar principal, posição relativa, quantidade de telas virtuais, Estender/Duplicar do Windows e abrir aplicativos em qualquer tela.
- **Qualidade configurável**: predefinições de 720p30 a 4K60, nativa do aparelho ou personalizada (até 120 fps e 80 Mbps), prioridade nitidez/fluidez, codec H.264/VP9/VP8 e orientação. A mudança vale na hora, sem reconectar.
- **Removidos Sunshine e Moonlight**: saem o runtime do Sunshine, o host GameStream (`SpaceviwerStream.exe`), o pareamento por PIN, a aba Moonlight, a descoberta de Smart TVs e o VB-CABLE. O instalador remove restos e regras de firewall de versões anteriores.
## SpaceViewer 2.2.29

- Sunshine oficial incluído no instalador para conectar o SpaceViewer ao Moonlight.
- Corrigida a inicialização do Sunshine ao abrir novamente o aplicativo ou restaurar a janela da bandeja.
- Configuração da tela restaurada pelo GUID, evitando falhas quando o Windows altera nomes como DISPLAY81 para DISPLAY337.
- Modos Estender e Duplicar selecionam, respectivamente, a tela virtual e a tela principal no Sunshine. Reconecte o Moonlight após trocar o modo.
- Verificação de que o Windows disponibilizou uma tela virtual independente antes de confirmar a extensão. Se a tela estendida estiver ausente, o aplicativo não muda silenciosamente a captura para o monitor principal.
- Navegação inferior simplificada: agentes dentro de Painel e monitor de rede dentro de Opções.
- Correções de carregamento das telas, mensagens de erro e salvamento das preferências.

Validação: 44 testes automatizados aprovados e dois ciclos reais de iniciar, encerrar e reiniciar o Sunshine com a API autenticada respondendo.

O Sunshine integrado transmite uma tela compartilhada e o áudio do Windows. Recursos específicos de áudio por aplicativo/TV e controle por sessão continuam disponíveis no backend nativo de compatibilidade. A extensão depende de o Windows disponibilizar o monitor virtual; sessões de Área de Trabalho Remota podem expor somente o adaptador remoto.

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
