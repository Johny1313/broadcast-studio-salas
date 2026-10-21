# PUBLIQUE A V1.9 SEM RENDER E SEM CLOUDFLARED

**Destino do projeto: Cloudflare Workers + LiveKit Cloud**

1. Extraia o ZIP **V1.9 Cloudflare Native**. Envie todo o conteúdo da pasta `BroadcastStudio-DualCanvas-V1.9.0-CLOUDFLARE/` para a raiz de um repositório **privado** no GitHub (inclua `wrangler.jsonc`, `public/`, `worker/`, `scripts/`, `package.json` e `desktop/`).
2. Entre em https://dash.cloudflare.com/ → **Workers & Pages** → **Create application** → **GitHub** → selecione o repositório.
3. **Worker name:** `broadcast-studio-salas`. **Root directory:** `/`. **Build command:** `npm install --no-audit --no-fund && npm run build`. **Deploy command:** `npx wrangler deploy`.
4. Em **Settings → Variables and Secrets**, adicione `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (Secret), `STUDIO_OPERATOR_KEY` (Secret). As três primeiras vêm do seu projeto em https://cloud.livekit.io/; a quarta você gera com 32+ caracteres aleatórios.
5. Faça deploy novamente, abra `https://SEU-WORKER.workers.dev/api/health`; a resposta precisa conter `configured:true`.
6. Abra `https://SEU-WORKER.workers.dev/`. Informe `STUDIO_OPERATOR_KEY` no painel LiveKit, crie sala, copie o convite e envie ao celular.
7. No computador, se precisar RTMP e FFmpeg, use `desktop/`. Ele também se conecta ao mesmo endereço HTTPS Cloudflare.

**Importante:** não é necessário instalar Cloudflared. Cloudflare hospeda as rotas da sala e arquivos web; LiveKit hospeda o transporte de áudio e vídeo. O acesso à Cloudflare, a conta LiveKit e a configuração dos segredos precisam ser feitos no seu painel. O projeto não está publicado automaticamente por este ZIP.

**Segurança:** jamais publique `.env`, `.dev.vars` preenchido, `LIVEKIT_API_SECRET` ou `STUDIO_OPERATOR_KEY` no GitHub ou em capturas de tela.

Veja README.md para detalhes, limitações e checklist.
