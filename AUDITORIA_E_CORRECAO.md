# Broadcast Studio — V1.9.2 (Auditoria de configuração LiveKit)

## Causa principal identificada
O código da V1.9 depende de quatro bindings no Worker. No `wrangler.jsonc` anterior,
`keep_vars` estava ausente. Segundo a documentação Cloudflare, deployments via Wrangler
podem remover variáveis do tipo **Variable** cadastradas manualmente pelo dashboard.
Isso torna a falta de `LIVEKIT_URL` depois de um deploy uma hipótese forte.

Além disso, a captura fornecida mostrou um Secret chamado `broadcast_studio_salas`,
que **não** substitui `STUDIO_OPERATOR_KEY`. O servidor original checava todas as
variáveis antes de validar a chave enviada pelo estúdio, então o erro de configuração
não era prova de que a chave do operador estava correta.

## Atualizações
- `wrangler.jsonc`: `keep_vars: true`; preserve variáveis do dashboard.
- `/api/studio/diagnostics`: nova rota autenticada por `x-studio-key`, devolvendo
  **somente** flags booleanas para os nomes esperados e confirmação de diferenciação.
- Botão **Diagnosticar configurações do LiveKit** no painel web e desktop.
- Testes novos: rotas, não vazamento, credenciais duplicadas e falta de operator key.
- Preservados endpoints anteriores, composição e gravação.

## Aplicação recomendada
1. Envie para `main` **somente** `wrangler.jsonc`, `worker/src/index.mjs`,
   `public/index.html`, `public/cloud-studio.js`, `desktop/index.html`,
   `desktop/cloud-studio.js` e `tests/cloudflare-worker.test.mjs` (caminhos preservados).
   Alternativamente, atualize o repositório com o ZIP completo já organizado.
2. Em Cloudflare → Worker `broadcast-studio-salas` → **Settings → Variables and Secrets**
   confira os nomes separados e corretos:
   - `LIVEKIT_URL` = URL `wss://` do LiveKit (Variable ou Secret)
   - `LIVEKIT_API_KEY` = chave LiveKit (Secret)
   - `LIVEKIT_API_SECRET` = segredo LiveKit (Secret)
   - `STUDIO_OPERATOR_KEY` = chave de operador distinta (Secret)
3. Após salvar **Deploy** no painel, evite colocar o conjunto de variáveis em `Build variables`: elas precisam estar no runtime do Worker.
4. Entre no estúdio, preencha a chave e clique **Diagnosticar configurações do LiveKit**.
5. Mesmo que todas as flags sejam válidas, ainda será necessário validar conexão com LiveKit real.

## Segurança
- Não envie valores sensíveis ao ChatGPT, não comite `.dev.vars`, `.env` ou secrets.
- O endpoint de diagnóstico exige a chave do operador e não devolve valores.
- `keep_vars` preserva variáveis atuais do painel; evite usar no futuro para
  substituir uma gestão de configuração formal com ambientes versionados.
- As alterações não podem ser implantadas aqui sem autorização GitHub de escrita e acesso Cloudflare.
