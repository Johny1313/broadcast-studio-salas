# Relatório V1.8.0 — LiveKit Cloud

## Resultados locais (20/10/2026)

- **29/29 testes de regressão** do Broadcast Studio V1.7.1 aprovados (`node --test tests/*.test.cjs`).
- **6/6 testes novos do backend** aprovados (`node --test cloud/tests/*.test.cjs`): rota health sem segredo, autenticação do operador, convites, sala de espera, aprovação, recusa, CORS restrito, recusa de origem HTTP e serviço correto de URL de convite com query string.
- `node --check` aprovado nos scripts `app.js`, `cloud-studio.js`, `cloud/server.cjs` e `cloud/web/guest.js`.
- Não há nenhum arquivo executável `cloudflared`, nem segredos reais em `.env` empacotados.
- Testes novos usaram simulação de `AccessToken`; **não foi possível instalar dependências externas no ambiente** porque o registro npm não está acessível aqui.

## Não homologado

- Instalação real de `livekit-server-sdk` e `livekit-client` no serviço hospedado.
- Conexão real com LiveKit Cloud, 8 participantes, vídeo e áudio via redes móveis, TURN e firewall.
- Integração visual e testes de interface em Chromium (acesso local bloqueado por política administrativa deste ambiente).
- Captura do vídeo remoto, sincronização, retorno de áudio e gravação em transmissão real.
- Uso em produção e instaladores assinados para Windows/Mac.

## Segurança e arquitetura

O serviço `cloud/` assina tokens temporários; somente este servidor recebe `LIVEKIT_API_SECRET`. A interface do estúdio utiliza uma **chave de operador separada**, mantida somente durante a sessão. Convidados aprovados recebem tokens temporários para uma sala específica. O backend atual usa um único processo e armazena a fila em memória (reiniciar o processo cancela as salas).
