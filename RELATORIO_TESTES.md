# Auditoria — Broadcast Studio V1.9.0 Cloudflare Native

## Escopo implementado

- Host e convite web estáticos atendidos pelo mesmo Worker.
- API de salas convertida de Node `http.createServer` para Fetch de Workers.
- SQLite Durable Objects por sala, sem dependência de memória global do processo.
- Tokens JWT LiveKit HS256 assinados via `crypto.subtle` no servidor; segredos não enviados ao visitante.
- Aprovação antes da entrega do token ao convidado.
- Rate limit básico por sala (18 solicitações/minuto/IP, no caminho de entrada), até 8 convidados por sala e validade de 12h.
- Recusa e sessão de produção protegidas por chave de operador.
- Código desktop V1.8 copiado integralmente, mantendo o módulo de saída RTMP.
- Rota autenticada de recuperação do convite para o operador.

## Testes realizados

- **10 testes de Worker**, incluindo segurança, CORS, persistência simulada, emissão/verificação de JWT, recusa, permissões e limite de convidados.
- **29 testes de regressão desktop** com Node.js v22, provenientes da linha V1.8.
- `node --check` nos scripts principais.

## Pendente de homologação

- Instalação NPM/build no servidor Cloudflare — ambiente desta auditoria sem acesso ao registro NPM.
- Deploy real com Wrangler na conta Cloudflare do usuário.
- Credenciais LiveKit reais, WebRTC entre celular e computador, mixagem e gravação de chamada real.
- Assinatura digital de um instalador Windows/Mac, que não faz parte deste ZIP de fontes.

**Não afirmar que a versão está em produção** antes dos testes de deploy e vídeo entre dispositivos.
