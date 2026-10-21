# Auditoria V1.9.3 — autenticação do operador

## Alterações
- A UI web não contém mais input para segredo de operador.
- Botão de entrada via Cloudflare Access (login de operador por sessão).
- Backend valida JWT RS256 do Access: issuer (domínio de equipe), audience (AUD), validade e assinatura pela chave pública disponibilizada pela Cloudflare.
- Rotas `/api/studio/*` exigem autenticação antes de gerar tokens LiveKit, criar salas ou aprovar participantes.
- `/guest.html` e `/api/guest/*` permanecem públicos para entrada de convidados com links válidos e aprovação.
- Chave legada do desktop só permanece para ambientes que ainda não configuraram Access.
- A chave de operador mencionada na conversa **não foi copiada nem inserida nos arquivos**. Deve ser rotacionada por ter sido compartilhada.

## Testes
- Testes do projeto via `node --test tests/cloudflare*.test.mjs`.
- Conferência de sintaxe com `node --check`.
- Comparação estática da UI para confirmar ausência de `cloudOperatorKey` em `public/`.
- Pendente: teste real na conta Cloudflare (Access, LiveKit e chamada via celular).

## Ponto de atenção
O aplicativo Electron local ainda tem autenticação legada. É proposital manter esse comportamento na primeira entrega para não introduzir uma alteração de acesso com risco de regressão na captação/RTMP. O novo login automático é para a V1.9.3 web; publicar o Worker não muda sozinho a forma de autenticação do Electron local.
