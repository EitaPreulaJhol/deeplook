FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates genisoimage \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --include=dev

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