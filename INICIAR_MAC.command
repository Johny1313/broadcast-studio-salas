#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 20+ necessário. Instale a versão oficial.'
  exit 1
fi
if [ -x ./node_modules/.bin/electron ]; then
  echo '[MODO DESKTOP] Iniciando Electron: bloqueador disponível.'
  exec ./node_modules/.bin/electron .
fi
echo '[ATENÇÃO] Modo navegador: bloqueador interno NÃO funciona.'
echo 'Para habilitar, execute manualmente: npm install ; npm start'
(sleep 1; open 'http://127.0.0.1:8791/') &
exec node server/room-server.cjs
