FROM node:26-slim AS base
ENV NODE_ENV=production
# Sem a telemetria e a checagem de versao do Prisma CLI (o `migrate deploy` da subida chamava a
# internet e gravava em ~/.cache). Com a raiz somente leitura (revisao, item 4), os caches do
# CLI vao para o /tmp, o unico lugar gravavel alem da pasta de backup.
ENV CHECKPOINT_DISABLE=1 \
  PRISMA_HIDE_UPDATE_MESSAGE=1 \
  XDG_CACHE_HOME=/tmp/.cache \
  XDG_CONFIG_HOME=/tmp/.config
WORKDIR /app

# pg_dump 16 (backup, item 81) do repositorio oficial do PostgreSQL (PGDG): o
# Debian traz uma versao mais velha, que nao exporta o Postgres 16 do compose.
# O upgrade traz as correcoes de seguranca que o Debian ja publicou e a imagem do Node ainda
# nao tem (item 6.19: o zlib1g da base reprovava no Trivy com duas CVEs altas).
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends openssl ca-certificates genisoimage curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && . /etc/os-release \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Compila com as dependencias de desenvolvimento, que nao vao para a imagem final.
FROM base AS build
# Versoes exatas do lockfile: o npm ci falha se ele divergir do package.json.
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json prisma.config.ts ./
COPY src ./src
COPY prisma ./prisma
# Prisma 7: o cliente e gerado em src/generated/prisma e compilado junto.
RUN npx prisma generate
RUN npm run build

FROM base
COPY package.json package-lock.json ./
# Depois da instalacao o npm nao tem mais serventia: o runtime so executa node (o entrypoint
# usa node_modules/.bin/prisma). Sai da imagem, e com ele os achados do Trivy no npm embutido
# (undici e brace-expansion), que nao sao dependencias do projeto (item 6.4).
RUN npm ci --omit=dev \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY prisma.config.ts ./
# O prisma.config.ts le os NOME_FILE (plano pos-revisao, 5.1) nas migracoes: o modulo vai junto
# (so usa o node:fs). Sem ele, a API nao migra ao subir.
COPY src/secret-files.ts ./src/secret-files.ts
COPY prisma ./prisma
# Pacotes de regras YARA (item 143).
COPY rules ./rules
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Sem root: analisa arquivos maliciosos e nao precisa alterar o proprio codigo.
USER node
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
