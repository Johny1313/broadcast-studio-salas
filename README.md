# Broadcast Studio Dual Canvas — V1.9.0 Cloudflare Native

## O que esta versão entrega

Uma estrutura **única para GitHub + Cloudflare Workers** com:

- Estúdio web por HTTPS com os dois canvas independentes (16:9 e 9:16).
- Até três composições de câmeras (locais ou convidados LiveKit) e a quarta para playlist.
- Moldura, fundo, logo e GC por formato, em PREVIEW e PROGRAM.
- Entrada de convidados com HTTPS em `/guest.html`, pelo celular ou navegador, sem instalar Cloudflared.
- Sala de espera, aprovação, recusa e máximo de oito convites/entradas por sala (três em composição).
- Backend com armazenamento persistente em Durable Objects (SQLite) e tokens temporários LiveKit assinados no Worker.
- Pasta `desktop/` com Electron e recursos de gravação e RTMP que permanecem **locais**.

## Estrutura do repositório

```
BroadcastStudio-DualCanvas-V1.9.0-CLOUDFLARE/
├── public/                  # Studio + página de convite que Cloudflare publica
├── worker/src/index.mjs     # API e sala persistente Durable Object
├── scripts/build.mjs        # Copia SDK LiveKit do NPM para public/vendor/
├── desktop/                 # Aplicativo Windows/Mac, mantido separado do Worker
├── tests/                   # Testes de API, segurança, aprovação e tokens
├── wrangler.jsonc           # Deploy Workers + assets + Durable Objects SQLite
├── package.json             # npm install; npm run build; npm test
└── .github/workflows/       # Testes em commits
```

## Publicar com GitHub + Cloudflare (sem Render)

1. Extraia o ZIP e envie **o conteúdo da pasta principal** para a raiz de um repositório **privado** no GitHub. O arquivo `wrangler.jsonc` precisa ficar na raiz. **Não envie arquivos `.env`, `.dev.vars`, chaves ou pastas `node_modules`.**
2. Em https://dash.cloudflare.com/ entre em **Workers & Pages → Create application → GitHub**. Escolha o repositório e o ramo `main`.
3. O nome do Worker deve ser **`broadcast-studio-salas`** para corresponder ao campo `name` do `wrangler.jsonc` (ou altere ambos para a mesma identificação).
4. Configure **Root directory:** `/` (raiz). **Build command:** `npm install --no-audit --no-fund && npm run build`. **Deploy command:** `npx wrangler deploy`.
5. No Worker, em **Settings → Variables and Secrets**, crie os **segredos**:

   | Variável | Valor |
   | --- | --- |
   | `LIVEKIT_URL` | `wss://...livekit.cloud` recebido do seu projeto LiveKit |
   | `LIVEKIT_API_KEY` | API Key do LiveKit |
   | `LIVEKIT_API_SECRET` | API Secret do LiveKit, **Secret** |
   | `STUDIO_OPERATOR_KEY` | chave aleatória de 32+ caracteres, **Secret** |
   | `ALLOWED_STUDIO_ORIGINS` | opcional, origens extras do estúdio separadas por vírgula |

   **Nunca** coloque `LIVEKIT_API_SECRET` e `STUDIO_OPERATOR_KEY` no `wrangler.jsonc`, em HTML ou no GitHub. Na interface do estúdio, utilize apenas `STUDIO_OPERATOR_KEY`.

6. Execute/repita o deployment após salvar secrets e confirme `https://SEU-WORKER.workers.dev/api/health` respondendo `configured:true`.
7. Abra a URL do Worker; no painel **Sala de convidados • LiveKit Cloud**, confira o endereço, informe sua `STUDIO_OPERATOR_KEY` e clique em **Criar sala LiveKit**. Copie o convite HTTPS e teste com outro celular usando rede móvel.
8. Para produzir no computador com RTMP e FFmpeg, execute **desktop/** com `npm install` e `npm start`. Nesse estúdio, use a mesma URL Cloudflare e a mesma chave de operador.

### Sem instalar nada na máquina?

Sim, para operar **o estúdio web e os convites remotos**, depois de publicados na Cloudflare, não é preciso instalar Cloudflared, Render ou Node local. Para **RTMP/FFmpeg desktop e bloqueio de anúncios do Electron**, continuam necessárias as ferramentas locais que já faziam parte do aplicativo. O bloqueio de anúncios **não funciona** no Chrome/Edge comuns.

### Sobre a chave de operador

No computador com Node instalado, você pode gerar uma chave aleatória com:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Não envie o resultado em chat nem prints. A Cloudflare permite inserir Secrets pelo painel.

## Testes locais

```bash
npm install
npm run build
npm test
npx wrangler dev
```

Para testar chamadas reais em desenvolvimento, crie seu próprio `.dev.vars` (baseado em `.dev.vars.example`, ignorado pelo Git). A URL local do Wrangler deve ter um caminho seguro para câmera/microfone. O backend sem LiveKit configurado responde 503, deliberadamente.

## Limitações e segurança

- **O pacote não está publicado na sua conta**: falta vincular seu GitHub à Cloudflare e inserir as credenciais LiveKit.
- **Não há LiveKit Cloud contratado/configurado por nós.** A hospedagem na Cloudflare não substitui o serviço de mídia LiveKit e suas cotas.
- Salas permanecem persistidas no Durable Object por até 12 horas desde a criação; um alarme do Durable Object programa a remoção dos dados ao expirar. Os tokens LiveKit expiram após 15 minutos; a aplicação pode solicitar outro token autenticado em uma reconexão.
- Se um convidado já recebeu token antes de uma mudança de estado, a remoção imediata do LiveKit exige uma etapa adicional de moderação que não está implementada nesta V1.9.
- Para retirar um convidado conectado na versão atual, o operador precisa usar controles do serviço LiveKit ou encerrar a sala; revogação de tokens e saída forçada ainda são pendências.
- LiveKit requer conexões permitidas pela rede do participante; Workers gerenciam apenas a API e os convites, **não** transportam diretamente todos os pacotes de áudio e vídeo.
- No estúdio web, gravação WebM depende das capacidades do navegador; saídas RTMP dependem do aplicativo desktop/FFmpeg.
- Imagens importadas como logo/fundo/moldura podem precisar ser recarregadas ao reiniciar o app; presets antigos salvam geometria, não necessariamente a imagem.
- A compatibilidade de um arquivo de vídeo de site externo com a captura/gravação permanece limitada. Alguns players de terceiros não permitem incorporar ou retransmitir vídeo.
- Sem ferramentas com acesso às credenciais LiveKit e à conta Cloudflare do usuário, **não foi possível testar publicação real, SDK remoto carregado, vídeo entre dois celulares ou Cloudflare deploy**. O script de build precisa ser executado na Cloudflare após `npm install`.

## Testes executados

- `npm test` na raiz: testes do Worker e tokens HMAC/WebCrypto com armazenamento simulado.
- `npm test` na pasta desktop: testes de regressão herdados da versão 1.8.
- Verificações sintáticas com `node --check` em scripts relevantes.

Ver `RELATORIO_TESTES.md`.
