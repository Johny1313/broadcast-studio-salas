# Broadcast Studio Dual Canvas V1.8 — Salas LiveKit Cloud

## O que foi adicionado

Esta evolução mantém as três janelas de câmera, a quarta janela de playlist, os dois canvas 16:9 / 9:16, layouts independentes, GCs, logo, moldura, fundo, gravação e RTMP. Adiciona um novo **módulo de reuniões remotas hospedadas**, que não usa `cloudflared` nem abre portas locais para convidados.

- Criar salas com convites HTTPS públicos a partir de um backend hospedado.
- Entrada pelo celular ou computador, sem instalar aplicativo no aparelho do convidado.
- Sala de espera: o convidado não recebe token de mídia antes de ser aprovado.
- Aprovação e recusa de convidados (até oito solicitações por sala nesta primeira versão).
- Distribuir até três convidados conectados nas janelas de câmera, com PREVIEW → PROGRAM.
- Áudio dos convidados recebido pelo compositor e opção de compartilhar o microfone conectado do estúdio com a sala.
- SDK LiveKit carregado do **seu próprio servidor de salas**, instalado via NPM nesse servidor.

## Etapas obrigatórias de configuração inicial

### A. Criar projeto LiveKit Cloud
1. Crie um projeto em https://cloud.livekit.io/.
2. Copie a URL WebSocket `wss://...livekit.cloud`, API Key e API Secret.
3. **Nunca cole a API Secret no estúdio local ou em links de convite.** Ela é exclusiva do ambiente do servidor.

### B. Publicar o serviço de salas (`cloud/`) em hospedagem HTTPS
1. Publique o projeto em um serviço Node.js que forneça HTTPS público (por exemplo, Render usando `render.yaml`).
2. Configure as variáveis de ambiente listadas em `cloud/.env.example` diretamente no painel privado da hospedagem. O arquivo `.env.example` é apenas documentação: não deve ser usado para colocar segredos num repositório público.
3. Use `PUBLIC_ORIGIN=https://SEU-SERVIDOR.onrender.com` (ou domínio próprio), sem barra final.
4. Crie `STUDIO_OPERATOR_KEY` com **32+ caracteres aleatórios diferentes** da API Key e API Secret do LiveKit.
5. Na hospedagem, a instalação dos pacotes é realizada com `npm install` na pasta `cloud`; o serviço roda com `npm start`. A rota `/api/health` responde `broadcast-livekit-cloud` quando configurada.
6. O processo Node deve operar atrás do HTTPS gerenciado pelo provedor. Configure **uma única instância**, pois as salas de espera são armazenadas em memória nesta V1.8.

### C. Conectar o aplicativo do produtor
1. Abra o estúdio local no Windows ou Mac como nas versões anteriores.
2. Em **Sala de convidados • LiveKit Cloud**, informe o `https://` do servidor e a `STUDIO_OPERATOR_KEY` (não é a API Secret).
3. Clique **Criar sala LiveKit**. O convite só aparecerá quando o serviço online responder.
4. Copie o link, envie ao convidado, aprove a entrada e selecione **Câmera 1/2/3**.
5. Clique **No ar** no canvas desejado. O quarto slot continua destinado à playlist.
6. Opcionalmente clique **Compartilhar microfone do estúdio**, após conectar o microfone local.

## Não precisa instalar Cloudflared
O host de salas está na internet e já recebe HTTPS; a transmissão WebRTC vai para o LiveKit Cloud. O aplicativo de produção continua no computador, mas **não precisa de software de túnel**. O acesso à internet e o projeto/hospedagem configurados são necessários. Instalar `node_modules`/Electron local é um procedimento separado já presente nas versões anteriores.

## Limitações reais
- Não existe um servidor LiveKit Cloud criado nem hospedagem publicada por esta entrega. Sem configurar LiveKit e a hospedagem, o botão Criar sala informa que não foi possível conectar.
- A sala em memória expira 12 horas após sua criação e reinicializações do backend invalidam os convites. Para produção de alta disponibilidade, usar armazenamento persistente/Redis e autenticação por usuário.
- Até oito **solicitações por sala** neste piloto; entradas e saídas frequentes requerem gerenciamento de participantes persistente.
- Convidados ou operadores em redes restritas ainda precisam de conectividade adequada até o LiveKit; servidor de mídia e políticas de firewall continuam aplicáveis.
- Retorno automático do áudio da playlist/monitoramento mix-minus profissional, gravação de trilhas isoladas e moderação avançada ainda precisam de implementação e testes.
- A gravação remota/RTMP depende da validação ponta a ponta com participantes reais; nenhuma chamada pública foi testada neste ambiente.
- Não afirme que há proteção de antivírus garantida: pacote com fonte não é código assinado. Não contém binários cloudflared ou segredo LiveKit.

## Testes
- `node --test tests/*.test.cjs` (regressões antigas).
- `node --test cloud/tests/*.test.cjs` (emissão de tokens simulados, autorização e aprovação).
- A execução real exige `npm install` na hospedagem com acesso ao registro NPM, além de projeto LiveKit.
