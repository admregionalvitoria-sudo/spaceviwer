# SpaceViewer

Transforma tablets, celulares e Smart TVs Android em **telas extras sem fio** do Windows: estenda a área de trabalho ou espelhe um monitor com latência ultrabaixa em tempo real (estilo Moonlight/spacedesk). Toda a configuração é feita no PC; o aparelho só roda o app receptor **SpaceViewer Display**.

- **Executável Windows (Electron)**: detecta os monitores, cria telas virtuais (driver MttVDD), alterna Estender/Duplicar, procura os aparelhos na rede e transmite o vídeo com aceleração de hardware pela GPU (`Windows.Graphics.Capture` + NVENC / QuickSync / Media Foundation) ou por WebRTC de reserva.
- **APK Android (`android/`)**: mostra nome, IP e porta do aparelho, responde à busca do PC, decodifica o vídeo por hardware (`MediaCodec`) direto em uma `SurfaceView` e reproduz áudio PCM estéreo de baixa latência (`AudioTrack`).

Arquitetura e protocolo PC ↔ APK: [docs/ARQUITETURA-TELA-ESTENDIDA.md](docs/ARQUITETURA-TELA-ESTENDIDA.md).

## Executar em desenvolvimento

```powershell
npm ci
npm run fetch:ffmpeg  # baixa o executável do FFmpeg LGPL caso necessário
npm run build:apk     # gera resources/apk/SpaceViewerDisplay.apk (servido pelo PC em /apk)
npm run dev
```

## Usar

1. Instale o **SpaceViewer Display** no aparelho: em **Telas → Instalar o app no aparelho** aparece um QR code que baixa o APK direto do PC (`http://IP-DO-PC:7523/apk`).
2. Abra o app no aparelho, na mesma rede Wi-Fi do PC. Ele mostra o nome, o **IP** e a porta.
3. No PC, abra **Telas** e clique em **Buscar** (ou digite o IP e clique em **Adicionar**).
4. Para cada aparelho, escolha:
   - **Estender (tela extra)**: um novo monitor do Windows aparece automaticamente à direita na resolução do aparelho, sem prompts de administrador. Ao desconectar, o monitor é removido.
   - **Duplicar (espelho)**: o aparelho mostra uma cópia do monitor escolhido como origem.
   - **Som**: envie o áudio do PC para o aparelho (PCM estéreo de baixa latência em modo nativo ou Opus em modo compatível) ou mantenha sem som.
5. Ações em massa: **Estender todas**, **Duplicar todas**, **Estender selecionadas**, **Duplicar selecionadas** e **Desconectar todas**.

Na mesma tela você controla os monitores do PC: mapa com a posição real, resolução e Hz por monitor, **Tornar principal**, posição em relação à principal e **Abrir aplicativo nesta tela** (mover a janela ou projetar uma cópia).

### Qualidade, várias TVs e Wi-Fi fraco

Em **Opções → Telas sem fio** ficam os padrões globais (qualidade de vídeo, banda total dividida entre as TVs, modo de transmissão e transmissão do som do PC em 96/128/192/256 kbps). Também é possível escolher a qualidade e a transmissão de som de cada aparelho em Telas.

- **Várias TVs e Wi-Fi fraco**:
  - **Banda total para todas as TVs**: limite global de largura de banda (10, 15, 20 Mbps padrão, 30 e 50 Mbps) distribuído automaticamente entre os aparelhos conectados (`total / TVs ativas`). Em redes Wi-Fi fracas ou com mais de uma TV, selecione 10–15 Mbps.
  - **Controle de congestionamento em tempo real**: monitoramento contínuo por RTT no socket TCP (a cada 200 ms). Ao detectar gargalo na fila do Windows, o app reduz a taxa de bits em 30% e descarte quadros com histerese sem congelar o receptor.
  - **Atualização intra (Intra Refresh)**: em encoders com suporte (NVENC e QuickSync), a tela se recupera imediatamente de descartes sem travar esperando quadros-chave (IDR).
  - **Diagnóstico**: botão "Abrir pasta de diagnóstico" permite visualizar o histórico de conexão, RTT e ajustes de bitrate gravados em `%ProgramData%\SpaceViewer\logs\spaceviewer.log`.

- **Modo de transmissão**:
  - **Tempo real (nativo, recomendado)**: captura na GPU pelo Windows Graphics Capture (`gfxcapture`), codifica em H.264 por hardware (NVENC / QuickSync / Media Foundation) com Intra Refresh, envia diretamente via TCP 47813 para a `SurfaceView` do Android e transmite áudio PCM não compactado.
  - **Compatível (WebRTC)**: transmissão padrão via WebRTC pelo navegador/WebView, utilizada automaticamente como contingência se o hardware ou o dispositivo não suportarem o modo nativo.

| Predefinição | Resolução | FPS | Bitrate |
|---|---|---|---|
| Economia | 1280×720 | 30 | 4 Mbps |
| Equilibrado | 1920×1080 | 60 | 12 Mbps |
| Alta | 2560×1440 | 60 | 25 Mbps |
| Ultra | 3840×2160 | 60 | 50 Mbps |
| Nativa do aparelho | a do painel | até 120 | automático |
| Personalizada | livre | 30/60/90/120 | 2–80 Mbps |

Também dá para definir prioridade (nitidez, equilibrada ou fluidez), codec (H.264, VP9 ou VP8) e orientação (paisagem, retrato ou automática). No modo Estender, o monitor é anexado na resolução escolhida; se o Windows recusar um tamanho exato, é usado o modo suportado mais próximo, com a mesma proporção.

## Rede e firewall

| Porta | Uso |
|---|---|
| UDP 47810 | busca: o PC envia `SPACEVIEWER_DISCOVER_V1` e o aparelho responde |
| UDP 47812 | anúncio do aparelho a cada 3 s |
| TCP 47811 (no aparelho) | controle: `/info`, `/connect`, `/disconnect` |
| TCP 47813 (no aparelho) | streaming em tempo real nativo (vídeo H.264 direto na GPU + áudio PCM) |
| TCP 7523 (no PC) | sinalização WebRTC e download do APK |

O instalador cria as regras. Em caso de problema, execute `CONFIGURAR_REDE_E_FIREWALL.bat` como administrador. A rede do Windows precisa estar como **Privada**.

## Instalador Windows

```powershell
npm run typecheck
npm run test:host
npm run package:win
```

`package:win` obtém o binário do FFmpeg (`npm run fetch:ffmpeg`), compila o controlador de telas (`build:native`, usa os binários pré-compilados se não houver MSYS2), gera o APK (`build:apk`), empacota o Electron e cria `dist-package/SpaceViewer-Setup-<versão>.exe` com o APK incluído.

### APK

`npm run build:apk` compila sem Gradle (aapt2, javac, d8, zipalign e apksigner do Android SDK 34 + JDK 17). Saídas: `dist-apk/SpaceViewerDisplay-<versão>.apk` e `resources/apk/SpaceViewerDisplay.apk`. A chave de assinatura local fica em `android/keystore/` (fora do git). No CI, defina os secrets `SPACEVIEWER_APK_KEYSTORE_BASE64` e `SPACEVIEWER_APK_KEYSTORE_PASSWORD` para manter a mesma assinatura entre versões; sem isso, o Android não instala uma versão nova por cima da antiga. Detalhes em [android/README.md](android/README.md).

## Testes

`npm run test:host` cobre o orquestrador de sessões (telas virtuais, resolução, espelho, desconexão, transporte nativo vs WebRTC), o particionador de fluxo Annex-B e construtor de argumentos do encoder nativo, a descoberta e o controle contra um aparelho simulado, o driver de telas virtuais, a captura e o mDNS.

## Modo Agente (PC como receptor)

O modo Agente (outro PC Windows recebendo a tela via WebRTC) continua disponível no inicializador.

## Licenças

- SpaceViewer: código proprietário / aberto conforme especificado no projeto.
- FFmpeg: redistribuído sob a licença GNU Lesser General Public License (LGPL) versão 2.1 ou posterior. Detalhes de compilação, scripts e código-fonte encontram-se documentados em `resources/ffmpeg/SOURCE.txt` e `resources/ffmpeg/LICENSE.txt`.
