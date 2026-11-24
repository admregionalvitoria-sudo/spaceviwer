# SpaceViewer Display (APK)

Receptor Android do SpaceViewer: transforma o tablet/celular em uma tela extra ou espelho do PC. O app não tem configurações próprias; tudo é controlado pelo SpaceViewer no Windows.

## O que o app faz

- **Tela de espera**: nome do aparelho, **IP**, porta de controle (47811), resolução/Hz e estado.
- **Descoberta**: responde `SPACEVIEWER_DISCOVER_V1` na UDP 47810, anuncia-se a cada 3 s na UDP 47812 (broadcast) e publica `_svdisplay._tcp` via mDNS/NSD.
- **Controle**: servidor HTTP na TCP 47811 (`GET /info`, `POST /connect`, `POST /disconnect`).
- **Vídeo**: ao receber `/connect`, abre `ws://PC:7523/?role=display&deviceId=…&sessionId=…`, responde à oferta WebRTC do PC e exibe o vídeo em tela cheia (imersiva, tela sempre ligada). Toque duas vezes para ver as estatísticas. Se a conexão cair, tenta reconectar por 60 s.

Protocolo completo: [../docs/ARQUITETURA-TELA-ESTENDIDA.md](../docs/ARQUITETURA-TELA-ESTENDIDA.md).

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `AndroidManifest.xml` | permissões de rede, tela cheia, launcher (inclui Android TV) |
| `src/com/spaceviewer/display/MainActivity.java` | WebView em tela cheia + ponte `SpaceViewerAndroid` |
| `src/.../DeviceInfoProvider.java` | JSON `DeviceInfo` (id estável, IPs, resolução real, Hz) |
| `src/.../DiscoveryResponder.java` | UDP 47810 / anúncio 47812 |
| `src/.../ControlServer.java` | HTTP 47811 |
| `src/.../NsdRegistrar.java` | mDNS `_svdisplay._tcp` |
| `assets/receiver.html/.js/.css` | tela de espera e player WebRTC |

Java puro, sem AndroidX nem bibliotecas externas (minSdk 24, targetSdk 34). Evite lambdas: o `android.jar` não traz o `LambdaMetafactory` usado pelo `javac`.

## Compilar

Requisitos: Android SDK com build-tools 34.0.0 e platforms/android-34 (`ANDROID_HOME` ou `%LOCALAPPDATA%\Android\Sdk`) e JDK 17 no PATH.

```powershell
npm run build:apk
# ou
powershell -ExecutionPolicy Bypass -File android/build-apk.ps1
```

Saída: `dist-apk/SpaceViewerDisplay-<versão>.apk` e `resources/apk/SpaceViewerDisplay.apk`. A versão vem do `package.json` da raiz.

Assinatura: na primeira compilação é gerada `android/keystore/spaceviewer-debug.keystore` (fora do git). Guarde-a: atualizações do app precisam da mesma chave. Para usar outra chave, defina `SPACEVIEWER_APK_KEYSTORE_BASE64`, `SPACEVIEWER_APK_KEYSTORE_PASSWORD` e (opcional) `SPACEVIEWER_APK_KEY_ALIAS`.

## Instalar no aparelho

No PC: **Telas → Instalar o app no aparelho** mostra um QR code para `http://IP-DO-PC:7523/apk`. Outra opção é copiar o APK e abri-lo no aparelho. O Android pede permissão para instalar apps dessa fonte.
