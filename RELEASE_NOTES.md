## SpaceViewer 2.2.13

- Corrige áudio silencioso quando o Moonlight envia o primeiro ping UDP antes de concluir o ANNOUNCE: o servidor aguarda os parâmetros finais de criptografia e duração antes de transmitir.
- Ajusta os timestamps de áudio para os milissegundos esperados pelo GameStream.
- Usa Opus com tamanho constante, compatível com os blocos de áudio do receptor Moonlight.
- Preserva a atribuição independente de telas e aplicativos por TV da versão 2.2.12.

Validação: 33 testes nativos, incluindo dois clientes com ping anterior ao ANNOUNCE, recepção UDP, descriptografia com chaves distintas, decodificação Opus e captura isolada de dois aplicativos; 11 testes de integração e verificação TypeScript.

Após atualizar, reconecte o Moonlight e selecione o aplicativo em Áudio exclusivo desta TV. A reprodução nas TVs físicas ainda precisa ser confirmada pelo usuário.
