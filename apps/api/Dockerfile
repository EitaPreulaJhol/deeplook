FROM node:26-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# pg_dump 16 (backup, item 81) do repositorio oficial do PostgreSQL (PGDG): o
# Debian traz uma versao mais velha, que nao exporta o Postgres 16 do compose.
RUN apt-get update \
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
COPY prisma ./prisma
# Pacotes de regras YARA (item 143).
COPY rules ./rules
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Sem root: analisa arquivos maliciosos e nao precisa alterar o proprio codigo.
USER node
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
