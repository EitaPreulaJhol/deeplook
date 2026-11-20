# Desofuscacao de JavaScript (plans/analise-estatica-ampliada, item 20): webcrack 2.16 (MIT), de
# j4k0xb. Sem rede, sem root e com a raiz somente leitura no compose; um container por analise
# (server.py). O codigo da amostra nao roda no Node: os decodificadores de strings rodam num isolate
# do V8 (isolated-vm), com memoria e tempo limitados.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# As versoes e os hashes vem do package-lock.json (npm ci confere a integridade de cada pacote).
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-slim
# python3 para o esqueleto comum dos servicos; as correcoes de seguranca que o Debian ja publicou.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10013 --no-create-home --shell /usr/sbin/nologin jsdeob \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/node_modules /app/node_modules
COPY package.json server.py deob.mjs /app/
ENV HOME=/tmp \
  NODE_ENV=production \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=4100

USER jsdeob
EXPOSE 4100
CMD ["python3", "/app/server.py"]
