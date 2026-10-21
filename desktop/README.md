# Broadcast Studio Desktop V1.9

Mantém os recursos de gravação, FFmpeg, canvas horizontal e vertical, 3 câmeras e playlist da V1.8.1.

Use `npm install` (ação explícita) e `npm start` para abrir Electron.

A sala pública é hospedada no Cloudflare Worker: cole o endereço HTTPS no painel LiveKit e forneça a chave de operador.

Nunca configure `LIVEKIT_API_SECRET` no desktop. A chave de operador é um segredo operacional e não deve ser divulgada.

A sala local antiga foi preservada apenas para compatibilidade; para convidados externos utilize a opção **LiveKit Cloud**.
