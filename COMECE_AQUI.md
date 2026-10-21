# Broadcast Studio V1.9.3 — Operador sem digitar chave

Esta versão **não embute nenhuma senha ou chave no HTML, no JavaScript ou no ZIP**. Para as salas online, o operador entra via **Cloudflare Access**, e a autenticação é feita com sessão protegida pela Cloudflare.

## IMPORTANTE: troque a chave divulgada em conversa

Uma chave de operador foi divulgada no histórico da conversa. Considere-a comprometida. **Não reutilize nem coloque a chave no código, GitHub ou captura.** Depois que o novo login estiver funcionando, remova/rotacione `STUDIO_OPERATOR_KEY` na Cloudflare; não altere segredos do LiveKit sem necessidade.

## 1. Publique a V1.9.3

Extraia este ZIP e envie o **conteúdo da pasta**, com `worker/`, `public/`, `scripts/`, `wrangler.jsonc` e `package.json` na raiz do repositório do GitHub.

Cloudflare Worker → Build:

- Build command: `npm install --no-audit --no-fund && npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

## 2. Crie um aplicativo Access PARA O CAMINHO DO OPERADOR

1. Cloudflare Dashboard → **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Nome: `Broadcast Studio Operadores`.
3. Domínio: o **mesmo hostname HTTPS** de seu Worker, por exemplo `broadcast-studio-salas.empresa.workers.dev`.
4. Proteja somente o caminho **`api/studio/*`**, não o domínio inteiro. O convidado precisa conseguir abrir `/guest.html` e `/api/guest/*` sem fazer login.
5. Política **Allow** restrita somente ao **seu e-mail de operador** (e-mail exato; não libere `Everyone`). Configure login por *One-time PIN* ou outro provedor confiável disponível.
6. Anote o **Application Audience (AUD) Tag** e o domínio de equipe, por exemplo `https://minha-equipe.cloudflareaccess.com`.

Documentação: https://developers.cloudflare.com/workers/configuration/cloudflare-access/ e https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/

## 3. Variáveis no Worker — Settings → Variables and Secrets (Production)

Necessárias:

- `LIVEKIT_URL` — URL `wss://` do projeto
- `LIVEKIT_API_KEY` — Secret do LiveKit
- `LIVEKIT_API_SECRET` — Secret do LiveKit
- `CLOUDFLARE_ACCESS_TEAM_DOMAIN` — texto: `https://minha-equipe.cloudflareaccess.com`
- `CLOUDFLARE_ACCESS_AUD` — texto: Application AUD Tag exato

**STUDIO_OPERATOR_KEY não é necessária no novo modo.** Não cole segredos na página do estúdio. Clique em **Deploy** após salvar.

## 4. Entre no estúdio sem digitar chave

1. Abra a página HTTPS do Broadcast Studio na Cloudflare.
2. Clique em **Entrar como operador (Cloudflare Access)**.
3. Faça login na aba aberta usando o seu e-mail autorizado.
4. Volte ao estúdio, clique em **Diagnosticar configurações do LiveKit** e depois **Criar sala LiveKit**.
5. Os convidados usam o link `/guest.html?...` e **não precisam fazer login no Access**.

A sessão é administrada pelo Cloudflare Access; quando expirar, faça login novamente. Não há chave do operador salva no navegador.

## Limitações e segurança

- Esta nova autenticação sem chave funciona no **estúdio WEB servido pela Cloudflare**. A edição Electron/desktop anterior mantém o campo de chave legado; para operar salas remotas sem chave, use a interface web hospedada até existir um login seguro integrado ao desktop.
- Não utilize **Protect this Worker** para todas as rotas: isso bloquearia os convites públicos. Proteja apenas `api/studio/*` no Access Self-hosted.
- O servidor verifica criptograficamente o JWT do Access (RS256, emissor, audiência e validade). Sem autenticação correta, não fornece tokens LiveKit nem cria salas.
- Os testes do projeto não provam que o login em sua conta Cloudflare está configurado; é necessário testar com o Worker real e um celular convidado.
- Não foi alterado o motor das câmeras, os canvas, as playlists, as gravações ou as rotas públicas dos convidados.
