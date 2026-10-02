#!/bin/sh
set -e

echo "[deeplook] Aplicando migracoes do banco..."
npx prisma migrate deploy

echo "[deeplook] Executando seed (admin)..."
npx prisma db seed || echo "[deeplook] seed ignorado (nao fatal)"

echo "[deeplook] Iniciando API..."
exec node dist/index.js