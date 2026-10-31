FROM node:22-slim

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

# Versoes exatas do lockfile: o npm ci falha se ele divergir do package.json.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json prisma.config.ts ./
COPY src ./src
COPY prisma ./prisma
# Prisma 7: o cliente e gerado em src/generated/prisma e compilado junto.
RUN npx prisma generate
RUN npm run build

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]