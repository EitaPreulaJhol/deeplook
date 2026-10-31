#!/bin/sh
# Roda os cenarios recebidos, mesmo com falha, e no fim lista os que falharam (saida 1).
failed=""
for s in "$@"; do
  node "$s.mjs" || failed="$failed $s"
done
if [ -n "$failed" ]; then
  echo "CENARIOS COM FALHA:$failed"
  exit 1
fi
