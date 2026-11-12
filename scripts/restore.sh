#!/bin/sh
# Restaura (ou so confere) um backup em ZIP do DeepLook (revisao de novembro, item 1.2).
#
#   scripts/restore.sh <backup.zip> --check       confere o ZIP com o manifesto; nao muda nada
#   scripts/restore.sh <backup.zip> --rehearsal   ensaio: restaura num banco e num bucket
#                                                 temporarios, compara as contagens e apaga os dois
#   scripts/restore.sh <backup.zip>               restaura na instalacao (para a API e o web antes)
#   scripts/restore.sh <backup.zip> --force       idem, mesmo que a instalacao ja tenha amostras
#
# A senha do ZIP vem da variavel RESTORE_PASSWORD; sem ela, o script pergunta (Enter = sem senha).
# Roda na imagem da API (docker compose run), que ja tem o pg_restore e a configuracao do banco e
# do MinIO do .env: no host so e preciso o Docker. O ZIP precisa ser legivel pelo usuario da API
# (uid 1000), como os que ela grava na pasta de backup.
set -eu

cd "$(dirname "$0")/.."

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

[ $# -ge 1 ] || usage
zip=$1
shift
[ -f "$zip" ] || { echo "arquivo não encontrado: $zip" >&2; exit 2; }
zip=$(cd "$(dirname "$zip")" && pwd)/$(basename "$zip")

mode=restore
for arg in "$@"; do
  case "$arg" in
    --check) mode=check ;;
    --rehearsal) mode=rehearsal ;;
    --force) ;;
    *) usage ;;
  esac
done

if [ -z "${RESTORE_PASSWORD+x}" ]; then
  if [ -t 0 ]; then
    printf 'Senha do ZIP (Enter se o backup não tem senha): ' >&2
    stty -echo 2>/dev/null || true
    read -r RESTORE_PASSWORD || RESTORE_PASSWORD=
    stty echo 2>/dev/null || true
    printf '\n' >&2
  else
    RESTORE_PASSWORD=
  fi
fi
export RESTORE_PASSWORD

if [ "$mode" = restore ]; then
  echo "Isto SUBSTITUI o banco e devolve os arquivos ao bucket desta instalação." >&2
  echo "A API e o web serão parados. Para só ensaiar, use --rehearsal." >&2
  if [ -t 0 ]; then
    printf 'Digite RESTAURAR para continuar: ' >&2
    read -r answer
    [ "$answer" = RESTAURAR ] || { echo "cancelado" >&2; exit 1; }
  fi
  docker compose stop web api
fi

docker compose up -d db minio
# -T: sem terminal, para a saida poder ir para um arquivo; a senha vai pelo ambiente, nao pela
# linha de comando.
docker compose run --rm -T -e RESTORE_PASSWORD -v "$zip:/restore/backup.zip:ro" \
  api node dist/restore.js /restore/backup.zip "$@"

if [ "$mode" = restore ]; then
  echo "Restaurado. Confira no .env a chave de dados da instalação de origem (DATA_KEY ou, se" >&2
  echo "ela não o tinha, o SESSION_SECRET) e suba: docker compose up -d" >&2
fi
