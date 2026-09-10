## SpaceViewer 2.2.16

- Corrige leitura dos espaços finais nos atributos SDP enviados pelo Moonlight real.
- Respeita a criptografia e a duração dos pacotes de áudio negociadas, evitando envio de áudio que a TV não consegue decodificar.
- Mantém áudio compartilhado via VB-CABLE e telas independentes.

Regressão reproduzida antes da correção: o receptor falhava ao descriptografar pacotes ao usar o formato real do Moonlight (atributos terminados em espaço e CRLF). O teste foi atualizado para preservar esse formato.

Após instalar, reconecte o Moonlight nas TVs para refazer a negociação.
