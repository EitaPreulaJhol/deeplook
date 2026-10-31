#!/bin/sh
set -e

echo "[deeplook] Aplicando migracoes do banco..."
node_modules/.bin/prisma migrate deploy

echo "[deeplook] Executando seed (admin)..."
node dist/seed.js || echo "[deeplook] seed ignorado (nao fatal)"

echo "[deeplook] Iniciando API..."
exec node dist/index.js