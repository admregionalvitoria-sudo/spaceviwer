# SpaceViewer 3.0 — Tela estendida / espelho para Android

Documento de arquitetura (contrato entre o executável Windows e o APK).
Toda configuração acontece no **exe**. O **APK é apenas um receptor** ("monitor sem fio").

## 1. Visão geral

```
┌──────────────────────── PC (SpaceViewer.exe / Electron) ───────────────────────┐
│ main process                                                                    │
│  display-topology.ts  → lista monitores, cria/remove telas virtuais (MttVDD),   │
│                          estender/duplicar, resolução/Hz/posição/primário       │
│  display-receivers.ts → busca APKs (UDP 47810 + anúncio 47812 + mDNS),          │
│                          comandos HTTP ao APK (connect/disconnect)              │
│  native-encoder.ts    → FFmpeg gfxcapture + hardware H.264 (NVENC/QSV/MF)       │
│  native-stream.ts     → sessão de streaming de ultrabaixa latência (TCP 47813)  │
│  signaling.ts (WS 7523) → sinalização WebRTC de reserva + serve o APK           │
│ renderer                                                                        │
│  ScreensPanel  (1ª tela) → mapa de telas + dispositivos + ações                 │
│  displayStreaming.ts → 1 captura + 1 RTCPeerConnection por receptor             │
│  nativeAudio.ts      → captura de áudio loopback PCM via AudioWorklet           │
└─────────────────────────────────────────────────────────────────────────────────┘
          │ UDP 47810/47812 (descoberta)   │ HTTP 47811 (controle)   │ TCP 47813 (tempo real) / WS 7523
┌──────────────────────── Android (SpaceViewer Display.apk) ─────────────────────┐
│ Java: MainActivity (WebView + SurfaceView baixa latência), StreamServer (47813) │
│       NativeVideoDecoder (MediaCodec direto na Surface), NativeAudioPlayer      │
│ assets/receiver.html|js|css: tela de espera (host/IP) + player WebRTC de reserva│
└─────────────────────────────────────────────────────────────────────────────────┘
```

Modos por receptor:

| Modo | O que acontece no PC | O que o APK mostra |
|---|---|---|
| `extend` | um monitor virtual do Windows é anexado dinamicamente via `ChangeDisplaySettingsEx` à direita dos demais na resolução do aparelho, sem elevação de administrador | o conteúdo daquela tela estendida |
| `mirror` | nenhuma alteração de topologia; captura o monitor de origem escolhido | cópia do monitor escolhido |

"Estender todas" = todo receptor conectado em `extend`, cada um com seu monitor estendido anexado.
"Duplicar todas" = todo receptor em `mirror` do monitor principal.
"Aplicar às selecionadas" = o mesmo, só para os receptores marcados (checkbox).

## 2. Remoções (limpeza)

Sunshine e Moonlight saem do produto:

- `src/main/sunshine-host.ts`, `src/main/gamestream-host.ts`, `src/main/tv-discovery.ts`
- `src/renderer/master/MoonlightPanel.tsx`, `src/renderer/components/TVAssignments.tsx`
- aba "Moonlight" do `BottomNav`; todos os IPCs `*moonlight*`, `*sunshine*`, `*gamestream*`, `native-session*`, `native-audio*`, `pair-moonlight-pin`, `smart-tvs*`
- tipos `SunshineStatus`, `GameStreamStatus`, `MoonlightClient`, `SunshineStreamStats`, `SunshineConfig`, `SmartTVDevice`, `NativeSession`, `NativeAudioStatus`, `HostSettings`, `HostDisplayInfo` (substituídos pelos tipos da seção 5)
- `scripts/download-sunshine.ps1`, script npm `prepare:sunshine`, `tests/sunshine-regressions.cjs`, extraResource `resources/sunshine`, trechos Sunshine/SpaceviwerStream-host do `installer.nsh`
- o exe **não inicia mais** `SpaceviwerStream.exe` (host GameStream). Continua usando apenas `SpaceviwerStreamDisplayCtl.exe` + `display-manager.ps1` + driver `driver/virtual-display`. O empacotamento exclui `SpaceviwerStream.exe`, `install-audio.ps1`, `migrate-host.ps1`.
- O código C++ em `native/` não é alterado nesta etapa.

Mantém: modo Agent (PC receptor via WebRTC), Dashboard, projetor de aplicativos, updater, tray.

## 3. Protocolo PC ↔ APK (contrato — não alterar sem atualizar os dois lados)

### 3.1 Descoberta

- APK escuta **UDP 47810**. Ao receber o datagrama ASCII `SPACEVIEWER_DISCOVER_V1`, responde (unicast ao remetente, mesma porta de origem) com o JSON `DeviceInfo`.
- APK **anuncia** o mesmo JSON a cada 3 s em broadcast `255.255.255.255:47812` (e no broadcast direcionado da sub-rede Wi-Fi). Usa `WifiManager.MulticastLock`.
- APK registra NSD (mDNS) tipo `_svdisplay._tcp`, porta 47811, TXT: `id`, `name`, `model`, `w`, `h`.
- PC: botão **Buscar** envia o datagrama para `255.255.255.255:47810` e para o broadcast de cada interface IPv4; escuta 47812 passivamente o tempo todo; navega `_svdisplay._tcp` via `bonjour-service`. Também aceita "Adicionar por IP" (GET `http://ip:47811/info`). Dispositivo some da lista após 10 s sem anúncio/resposta (exceto se conectado).

`DeviceInfo` (JSON, UTF-8):
```json
{
  "type": "spaceviewer-display", "protocol": 2,
  "id": "uuid estável (SharedPreferences)",
  "name": "Nome do aparelho (Settings.Global.DEVICE_NAME ou Build.MODEL)",
  "model": "SM-X710", "manufacturer": "samsung", "android": "14", "appVersion": "3.1.0",
  "ip": "192.168.0.42", "controlPort": 47811, "streamPort": 47813,
  "capabilities": ["webrtc", "native-h264", "pcm-audio"],
  "width": 2560, "height": 1600, "refreshRate": 120, "density": 2.0,
  "orientation": "landscape",
  "state": "idle" | "connecting" | "streaming",
  "connectedTo": "NOME-DO-PC" | null
}
```
`width/height` = resolução física real (`Display.getRealMetrics`) já na orientação paisagem (maior lado = width).

### 3.2 Controle (HTTP/1.1 simples no APK, TCP 47811)

| Método/rota | Corpo | Resposta |
|---|---|---|
| `GET /info` | — | `DeviceInfo` |
| `POST /connect` | `{"host":"192.168.0.10","port":7523,"masterName":"PC-SALA","sessionId":"uuid","mode":"extend","label":"Tela 3 (virtual)","orientation":"landscape"\|"portrait"\|"auto","transport":"native"\|"webrtc","streamPort":47813}` | `{"ok":true}` |
| `POST /disconnect` | `{}` | `{"ok":true}` |

Respostas com `Content-Type: application/json` e `Access-Control-Allow-Origin: *`. Conexão fechada após cada resposta.

### 3.3 Sinalização (WebSocket do exe, `ws://host:7523/?role=display&deviceId=<id>&sessionId=<sid>`)

APK → PC, logo após abrir:
```json
{"type":"agent-info","payload":{"kind":"display","deviceId":"…","sessionId":"…","name":"…","os":"android","model":"…","resolution":{"width":2560,"height":1600},"refreshRate":120}}
```
O `SignalingServer` aceita automaticamente (`auth-response` `status:"ok"`) quando `kind==="display"` e `sessionId` corresponde a um `/connect` emitido pelo próprio exe nos últimos 60 s (ou a uma sessão ativa desse `deviceId`). Caso contrário fecha a conexão.

PC → APK:
- `{"type":"stream-config","payload":{"label","mode","width","height","fps","orientation","audio"}}`
- `{"type":"webrtc-offer","payload":{"type":"offer","sdp":"…"}}` (formato simple-peer)
- `{"type":"ice-candidate","payload":{"type":"candidate","candidate":{"candidate","sdpMLineIndex","sdpMid"}}}`
- `{"type":"stream-stop","payload":{"reason":"stopped"|"reconfigure"}}`

O áudio é o mix do sistema do Windows (loopback) capturado pelo Chromium (`chromeMediaSource: 'desktop'` áudio). É enviado como uma faixa Opus estéreo no MESMO peer WebRTC e no MESMO MediaStream do vídeo. Quando `audio: false` no `stream-config`, o receptor mantém o vídeo em mudo.

APK → PC (sem `targetId`, roteado ao renderer):
- `{"type":"webrtc-answer","payload":{"type":"answer","sdp":"…"}}`
- `{"type":"ice-candidate","payload":{"candidate":{"candidate","sdpMLineIndex","sdpMid"}}}`
- `{"type":"display-stats","payload":{"fps":60,"width":2560,"height":1600,"jitterMs":3,"framesDropped":0,"decoder":"…"}}` a cada 2 s
- `{"type":"ping","payload":<ms>}` a cada 5 s

O APK é sempre o lado *answerer*; aceita o datachannel criado pelo simple-peer (`ondatachannel`) e não envia mídia.
Se o PC enviar uma nova oferta (reconfiguração), o APK descarta o RTCPeerConnection anterior e responde à nova.

### 3.4 Download do APK

O `SignalingServer` responde `GET /apk` (e `/SpaceViewerDisplay.apk`) com o arquivo `resources/apk/SpaceViewerDisplay.apk` (`application/vnd.android.package-archive`). O exe mostra um QR Code de `http://<ip-lan>:7523/apk` na tela de dispositivos.

### 3.5 Protocolo de transmissão em tempo real nativo (TCP 47813)

Introduzido no SpaceViewer 3.1.0 e aprimorado no 3.2.0 como transporte de ultrabaixa latência (Moonlight/spacedesk-like), operando em conjunto com a captura direta via GPU (`Windows.Graphics.Capture`), encoder de hardware H.264 (NVENC / QuickSync / Media Foundation) no PC com atualização intra (intra-refresh) e decodificador `MediaCodec` direto na `SurfaceView` do Android. O transporte WebRTC (§3.3) permanece como reserva automática ("Compatível").

- O APK escuta na porta **TCP 47813** (`streamPort`). O PC conecta em `device.ip:47813` (cliente) logo após um `POST /connect` bem-sucedido com `"transport":"native"`. Um cliente por vez: uma nova conexão substitui a anterior. Ambas as pontas ativam `setNoDelay(true)` / `socket.setNoDelay(true)`. O buffer de recebimento do socket do APK é fixado em 256 KiB para evitar filas ocultas no SO.
- Enquadramento: cabeçalho binário de 12 bytes + payload.
  - Byte 0: `0x53` ('S')
  - Byte 1: `0x56` ('V')
  - Byte 2: `type` (1 a 8)
  - Byte 3: `flags` (bit 0 = keyframe no tipo VIDEO)
  - Bytes 4-7: `payload length` (uint32 big-endian, máx. 8 MiB)
  - Bytes 8-11: `timestamp` (uint32 big-endian, `Date.now() & 0xffffffff` em ms)
- Tipos de mensagens PC → APK:
  - `1 VIDEO`: Uma unidade de acesso H.264 (Annex-B), iniciando com o NAL AUD (`00 00 00 01 09` ou `00 00 01 09`); `flags & 1 != 0` indica keyframe (contém NAL tipo 5 IDR). Em encoders com intra-refresh (NVENC/QSV), apenas o quadro inicial é IDR e o fluxo se recupera continuamente.
  - `2 AUDIO`: Amostras PCM s16le, 48 000 Hz, estéreo intercalado (10 ms = 1 920 bytes por mensagem). Protegido contra descartes, sofrendo corte apenas se o atraso de fila exceder 300 ms.
  - `3 CONFIG`: JSON UTF-8 (`{ "width", "height", "fps", "audio": bool, "label", "sessionId", "codec": "h264", "intraRefresh": bool }`). Enviado na inicialização e em alterações de geometria (reinícios por taxa de bits não reenviam CONFIG nem recriam o decodificador).
  - `4 PING`: JSON UTF-8 (`{ "t": <ms> }`) enviado a cada 200 ms.
  - `8 BYE`: Mensagem vazia de encerramento enviada pelo PC ao parar a sessão.
- Tipos de mensagens APK → PC:
  - `5 PONG`: Eco imediato do JSON do PING para cálculo de RTT pelo controlador de congestionamento.
  - `6 STATS`: JSON UTF-8 emitido a cada 1 segundo (`{ "fps", "decodeMs", "queue", "dropped", "maxGapMs", "width", "height" }`).
  - `7 READY`: JSON UTF-8 (`{ "decoder": <nome do MediaCodec> }`) emitido assim que o decodificador é configurado com o primeiro keyframe.
- Controle de congestionamento:
  - Baseado no atraso de fila real `queueDelay = srtt - baseRtt` (onde srtt é a média EWMA alpha=0,25 e baseRtt é o menor RTT dos últimos 10 s).
  - Descarte seguro com histerese (entra em descarte se atraso > 80 ms ou buffer local > 1,5 quadro; sai apenas com atraso < 30 ms e buffer zerado).
  - Bitrate adaptativo por sessão: queda de 30% após perdas sustentadas (>5% ou >20% do tempo em descarte por 4 s) até o piso de 1,5 Mbps; aumento gradual de 15% após 20 s contínuos estáveis.
- DeviceInfo (APK): `protocol: 2`, campos `capabilities: ["webrtc", "native-h264", "pcm-audio"]` e `streamPort: 47813`.

## 4. Qualidade (configurada no exe)

Configuração global (`AppSettings.display`) com sobreposição por receptor:

| Campo | Valores |
|---|---|
| `totalBitrateKbps` | Banda total dividida igualmente entre as TVs ativas: 10 000, 15 000, 20 000 (padrão), 30 000, 50 000 kbps (em Wi-Fi fraco recomenda-se 10–15 Mbps) |
| `preset` | `economy` 1280×720@60 5 Mbps · `balanced` 1920×1080@60 12 Mbps · `high` 2560×1440@60 25 Mbps · `ultra` 3840×2160@60 50 Mbps · `native` resolução/Hz do aparelho, bitrate = w·h·fps·0,1 bps (limitado a 80 Mbps) · `custom` |
| `width`,`height` | custom |
| `fps` | 30 · 60 (mínimo padrão nas predefinições) · 90 · 120 (limitado ao `refreshRate` do aparelho) |
| `bitrateKbps` | 2 000 – 80 000 |
| `codec` | `H264` (padrão, decodificação por hardware no Android) · `VP9` · `VP8` |
| `priority` | `smoothness` (padrão, `degradationPreference:"maintain-framerate"`, `contentHint:"motion"`) · `balanced` (`maintain-framerate`, `motion`) · `sharpness` (`maintain-resolution`, `detail`) |
| `orientation` | `landscape` · `portrait` · `auto` |
| `audio` | `enabled: boolean` (padrão `true`), `bitrateKbps`: 96 · 128 · 192 (padrão) · 256 |
| `transport` | `webrtc` (padrão, qualidade e fluidez) · `native` (tempo real com aceleração de hardware) |

Aplicação:
- **extend**: a tela virtual é configurada com `SpaceviwerStreamDisplayCtl.exe mode <\\.\DISPLAYn> W H Hz` (W×H trocados se `portrait`).
- captura: `getUserMedia({video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId, minWidth:W,maxWidth:W,minHeight:H,maxHeight:H,minFrameRate:fps,maxFrameRate:fps}}, audio: {mandatory: {chromeMediaSource: 'desktop', ...}}})`, `videoTrack.contentHint` conforme prioridade, `audioTrack.contentHint = 'music'`.
- encoder: `RTCRtpSender.setParameters` → `maxBitrate`, `maxFramerate`, `degradationPreference: 'maintain-framerate'` (exceto sharpness), `scaleResolutionDownBy:1`; SDP com codec preferido e `x-google-start-bitrate`/`x-google-min-bitrate` = 80%/30% do alvo; `b=AS` = alvo. Áudio configurado via `preferOpusStereo` com `stereo=1`, `sprop-stereo=1`, `maxaveragebitrate` e `networkPriority/priority='high'`.
- receptor Android: segura `WifiManager.WifiLock` em modo de baixa latência (`WIFI_MODE_FULL_LOW_LATENCY` no Android 10+ / `WIFI_MODE_FULL_HIGH_PERF`) durante a transmissão e configura `jitterBufferTarget = 0` e `playoutDelayHint = 0` no WebRTC.
- mudar qualidade ou áudio de um receptor ativo = `stream-stop{reason:"reconfigure"}` + nova captura/oferta (sem reconectar o WebSocket).

## 5. Exe — módulos e tipos

### 5.1 `src/main/display-topology.ts` (substitui gamestream-host + windows-displays)
```ts
interface PcDisplay { id: string /* electron display id */; deviceName: string /* \\.\DISPLAYn */; label: string;
  bounds:{x,y,width,height}; width:number; height:number; refreshRate:number; scaleFactor:number;
  primary:boolean; virtual:boolean; sourceId:string /* desktopCapturer screen:… */; thumbnail:string;
  assignedReceiverId?: string|null }
listPcDisplays(): Promise<PcDisplay[]>
getVirtualDriverState(): Promise<{installed:boolean; enabled:boolean; count:number; outputs:number}>
installVirtualDriver(): Promise<Result>
attachVirtualDisplay(w, h, hz, busyDeviceNames): Promise<{ success: boolean; error?: string; display?: PcDisplay }>
detachVirtualDisplay(deviceName): Promise<Result>
setDisplayMode(deviceName, w, h, hz): Promise<Result>   // DisplayCtl mode
setDisplayPosition(deviceName, x, y): Promise<Result>   // display-manager.ps1 -Action set-position
setPrimaryDisplay(deviceName): Promise<Result>          // display-manager.ps1 -Action set-primary
type Result = { success: boolean; error?: string }
```
`display-manager.ps1`: driver instalado uma única vez (no instalador ou pelo botão de instalação com elevação) com `monitors.count = 4` e saídas inicialmente desanexadas; em tempo de execução, ações `attach -Device -X -Y -Width -Height -Hz` e `detach -Device` / `detach-all` anexam e desanexam monitores via `ChangeDisplaySettingsEx` sem necessidade de elevação de administrador; `query` retorna `virtualOutputs` detalhando as saídas do driver virtual.

### 5.2 `src/main/display-receivers.ts`
```ts
interface DisplayReceiver extends DeviceInfo { lastSeen:number; online:boolean; source:'udp'|'mdns'|'manual';
  session?: { sessionId:string; agentId?:string; mode:'extend'|'mirror'; displayDeviceName?:string; status:'connecting'|'streaming'|'error'; error?:string } }
class DisplayReceivers extends EventEmitter { start(); stop(); scan(); addManual(ip); list(): DisplayReceiver[];
  connect(id, {mode, label, orientation}): Promise<{sessionId}>; disconnect(id); isExpectedSession(sessionId, deviceId): boolean }
// emite 'updated' (lista) → IPC 'display-receivers-updated'
```

### 5.3 Orquestração (`src/main/display-sessions.ts`)
`startReceiver(id, assignment)`:
1. `extend`: chama `attachVirtualDisplay(width, height, fps, busyDeviceNames)` para anexar uma saída livre na resolução do aparelho imediatamente à direita das telas existentes (sem UAC); atualiza a qualidade e o identificador do monitor estendido; aguarda o `screen` do Electron refletir a nova tela.
2. `mirror`: valida o `sourceDisplay` escolhido.
3. Se o transporte for nativo (`shouldUseNative`), dispara `connect` com `transport: 'native'`, inicializa `NativeStreamSession` apontando para o TCP 47813 do Android e encadeia o áudio PCM loopback. Se falhar antes de estar pronto, faz fallback transparente para WebRTC.
4. Se o transporte for WebRTC: APK abre WS → signaling auto-aceita → main envia ao renderer `display-session-ready {agentId, receiverId, sourceId, quality, label}` → renderer captura + oferta WebRTC; stats voltam por IPC.
`stopReceiver(id)`: encerra a sessão ativa (`nativeSession.stop()` ou `stream-stop`), `/disconnect`; se for sessão `extend`, chama `detachVirtualDisplay(virtualDeviceName)` (a menos que a opção "Manter o monitor estendido ao desconectar" esteja ativada).
Ao iniciar a aplicação, telas virtuais deixadas anexadas por falhas anteriores são desanexadas via `detachAllVirtualOutputs()`.
Atribuições persistem em `electron-store` (`receiverAssignments[deviceId]`) e, com `autoConnect`, são reaplicadas quando o aparelho reaparece.

### 5.4 Renderer
- `ScreensPanel.tsx` (aba **Telas**, primeira tela): 
  - mapa visual proporcional das telas do PC (posição real, principal, virtual/estendida com nome do aparelho atribuído), clique seleciona; painel lateral da tela: resolução/Hz (lista), definir como principal, mover (esquerda/direita/acima/abaixo da principal) e abrir aplicativos em qualquer tela.
  - card de status de tela estendida: aviso de driver não instalado com botão para instalar uma única vez ou status pronto; botão de corrigir cursor.
  - lista **Dispositivos na rede** (APKs): nome, modelo, IP, resolução, estado; botão **Buscar**, "Adicionar por IP", QR do APK; checkbox de seleção; por dispositivo: modo (Estender / Duplicar tela X), qualidade (preset), Conectar/Desconectar, stats (fps, Mbps, latência, codificador/decodificador).
  - ações em massa: **Estender todas**, **Duplicar todas**, **Estender selecionadas**, **Duplicar selecionadas**, **Desconectar todas**.
- `Settings.tsx`: seção "Qualidade das telas" (seção 4) incluindo seleção de "Modo de transmissão" (Tempo real nativo vs Compatível WebRTC) + "Manter o monitor estendido ao desconectar" + "Reconectar automaticamente".
- `displayStreaming.ts`: hook/engine independente do engine Agent existente; gerencia sessões WebRTC e integra a captura loopback de áudio estéreo de baixa latência para sessões nativas.

## 6. APK — `android/`

- Pacote `com.spaceviewer.display`, `minSdk 24`, `targetSdk 34`, versão = `package.json`.
- Build **sem Gradle**: `android/build-apk.ps1` (aapt2 → javac `--release`/`-source 8` contra `android.jar` → d8 → zipalign → apksigner; keystore em `android/keystore/` gerada por `keytool` se faltar, ignorada no git). SDK: `$env:ANDROID_HOME` ou `%LOCALAPPDATA%\Android\Sdk`, build-tools 34.0.0, platform android-34. Saída: `dist-apk/SpaceViewerDisplay-<versão>.apk` e cópia em `resources/apk/SpaceViewerDisplay.apk`.
- Java: `MainActivity` (imersivo, `FLAG_KEEP_SCREEN_ON`, FrameLayout com WebView + SurfaceView acelerada por hardware + overlay de stats; decodificação de vídeo de baixa latência via `NativeVideoDecoder` / `MediaCodec`, reprodução de áudio PCM de baixa latência via `NativeAudioPlayer` / `AudioTrack`), `StreamServer` (TCP 47813), `DiscoveryResponder` (UDP 47810 + anúncio 47812), `ControlServer` (HTTP 47811), `NsdRegistrar`, `DeviceInfoProvider`.
- Manifest: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`, `WAKE_LOCK`; `usesCleartextTraffic=true`; `hardwareAccelerated=true`; `screenOrientation=sensorLandscape` (alterável pelo exe).
- `assets/receiver.html|js|css`:
  - **Espera**: logo, nome do aparelho, **IP e porta em destaque**, resolução, estado ("Aguardando o computador…"), instrução "No PC abra o SpaceViewer → Telas → Buscar".
  - **Transmitindo**: vídeo com aceleração nativa via `SurfaceView` direta e áudio PCM, ou fallback WebRTC (`<video>` tela cheia, `object-fit: contain`, fundo preto, `muted playsinline autoplay`); overlay com estatísticas em tempo real ativado por toque duplo.
  - Reconexão: se o WS cair sem `stream-stop`, tenta novamente a cada 2 s por 60 s, depois volta à espera.
- Ícone a partir de `resources/icon.png`.

## 7. Portas / firewall
UDP 47810, 47812 e TCP 7523 de entrada no PC (regra adicionada pelo instalador NSIS e pelo `CONFIGURAR_REDE_E_FIREWALL.bat`); TCP 47811 (controle), TCP 47813 (tempo real nativo) e UDP 47810 no Android (sem firewall).
