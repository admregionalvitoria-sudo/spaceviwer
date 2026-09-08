# SpaceViewer

> Central de Transmissão, Extensão de Telas e Espelhamento de Alta Performance em Rede Local.

---

## Regras Mandatórias de Desenvolvimento e Interface

Para manter a consistência, integridade e o padrão visual premium do **SpaceViewer**, todos os desenvolvedores e contribuintes devem seguir rigorosamente as seguintes diretrizes:

### Regra 1: PROIBIDO O USO DE EMOJIS NO APLICATIVO
- **Nunca insira caracteres de emoji (Unicode emojis) na interface do usuário.**
- Todos os elementos visuais, botões, abas, badges, cartões e alertas devem utilizar **exclusivamente ícones vetoriais modernos (SVGs limpos)**.
- O design do SpaceViewer é profissional, elegante e minimalista. Emojis poluem a interface e quebram a consistência tipográfica entre plataformas.

### Regra 2: O ÍCONE DO MOONLIGHT DEVE SER SEMPRE UMA LUA CRESCENTE
- Em todas as ocorrências do recurso **Moonlight** (na barra de navegação inferior, na barra lateral, no gerenciador de telas e no painel de controle do Moonlight), o ícone deve ser estritamente uma **lua crescente vetorial moderna (SVG)**.
- Nunca utilize ícones genéricos de monitores, setas ou emojis para referenciar o Moonlight.

### Regra 3: PADRÃO VISUAL E DESIGN SYSTEM
- Mantenha a paleta de cores limpa com alto contraste, tons neutros sofisticados e detalhes em esmeralda/ciano/âmbar para status funcionais.
- Efeitos visuais refinados (`GlassCard`, microinterações e transições fluidas).
- Não utilize referências a softwares terceiros na interface quando houver funcionalidade nativa (ex: utilizar "Transmitir Aplicativo" em vez de referências a OBS).

### Regra 4: REGISTRO OBRIGATÓRIO DA ÚLTIMA ATUALIZAÇÃO NO README
- A cada nova funcionalidade, correção ou liberação de versão, este arquivo `README.md` deve ser atualizado com a versão mais recente e os detalhes das mudanças na seção **Histórico de Atualizações**.

---

## Histórico de Atualizações (Changelog)

### [v2.2.1] — Versão Atual
- **Remoção Completa de Emojis**: Varredura minuciosa em todo o código-fonte (`src/`), substituindo qualquer resquício de emojis por ícones SVG geométricos e modernos.
- **Ícone do Moonlight Unificado**: Atualizado para a silhueta da lua crescente em SVG em todas as instâncias (Barra Inferior `BottomNav`, Barra Lateral `Sidebar`, Cartões de Telas `ScreensPanel` e Painel do Host `MoonlightPanel`).
- **Sistema de Auto-Update Integrado (GitHub Releases)**:
  - Adicionada aba dedicada de **Atualização** na tela de **Configurações / Ajustes**.
  - Verificação em tempo real de novas versões no repositório GitHub (`spaceviwer`).
  - Download em segundo plano com barra de progresso em tempo real (MB transferidos, porcentagem e velocidade de download).
  - Execução de atualização *in-place* sem necessidade de desinstalar a versão anterior e sem perda de dados ou configurações.
- **Gerenciador de Telas como Tela Principal**:
  - Nova aba inicial exibindo em tempo real todas as telas conectadas (físicas e virtuais do Moonlight).
  - Previews ao vivo de cada monitor.
- **Transmissão Seletiva de Aplicativos ("Transmitir Aplicativo")**:
  - Escolha qualquer janela aberta no Windows e projete diretamente em tela cheia na tela física ou virtual desejada.
  - Controle independente de streaming sem bloquear a área de trabalho do usuário.
- **Correção da Janela Projetora**:
  - Resolução definitiva de erros de carregamento de janelas projetoras em builds empacotados (`.asar`) com suporte a roteamento de URL hash e canal IPC redundante.

---

### [v2.2.0]
- **Driver de Display Virtual MTT VDD**:
  - Suporte a criação de segunda tela virtual independente sem necessidade de adaptadores HDMI falsos (dummy plugs).
  - Controle de topologia de exibição (Estender Área de Trabalho vs Duplicar/Espelhar).
- **Servidor Host Nativo para Moonlight**:
  - Transmissão direta para o aplicativo Moonlight instalado em Smart TVs (LG webOS, Samsung Tizen, Android TV, Apple TV, Fire TV) e dispositivos móveis.
  - Autodescoberta via mDNS / Bonjour (`_nvstream._tcp`).
  - Pareamento simplificado via código PIN de 4 dígitos na própria interface.
- **Modos de Instalação e Execução**:
  - Separação entre modo Transmissor (Master) e modo Receptor (Agent).
  - Instalação prioritária com privilégios de Administrador para correto controle dos drivers de vídeo e rede.

---

## Funcionalidades Principais

1. **Gerenciador de Telas Unificado**: Visualize todos os monitores disponíveis, resoluções, posições e o que está sendo transmitido em tempo real.
2. **Extensão de Tela para Smart TVs**: Transforme sua TV em um segundo monitor estendido sem cabos.
3. **Projeção de Janelas / Apps**: Envie a janela de qualquer programa (jogos, navegadores, dashboards) diretamente para o monitor escolhido.
4. **Atualizações Automáticas**: Atualize o aplicativo diretamente pela interface em um clique.
5. **Ultra Baixa Latência**: Codificação por hardware (NVENC, AMF, QuickSync) via H.264/VP9 em até 120 FPS.

---

## Comandos de Desenvolvimento

```bash
# Instalar dependências
npm install

# Iniciar em modo de desenvolvimento
npm run dev

# Compilar código de produção
npm run build

# Gerar instalador Windows (Setup .exe)
npm run package:win
```

---

## Repositório Oficial

- **GitHub**: [https://github.com/admregionalvitoria-sudo/spaceviwer](https://github.com/admregionalvitoria-sudo/spaceviwer)
- **Desenvolvedor**: SpaceViewer Team
- **Licença**: MIT
