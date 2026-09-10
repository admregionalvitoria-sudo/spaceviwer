## SpaceViewer 2.2.14

- Corrige o erro HTTP 403 na busca de atualizações causado pelo limite de consultas da API pública do GitHub.
- Consulta o manifesto público latest.yml, sem token e sem depender da API REST.
- Valida versão e nome do instalador, limita redirecionamentos e mantém erros de conexão visíveis.

Validação: quatro testes do atualizador e consulta/download reais com a API REST retornando 403. Preserva as correções de áudio e telas anteriores.

Quem estiver com o atualizador bloqueado na versão anterior pode instalar esta versão pelo download direto da release. As próximas consultas usam o novo mecanismo.
