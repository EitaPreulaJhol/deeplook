# Captura de rede do sandbox (plano pos-revisao, item 5.4): so Node, sem dependencia de npm (a
# biblioteca padrao basta). Recebe o TZSP do MikroTik por UDP e grava os pcaps num tmpfs.
FROM node:26-slim

WORKDIR /app
# As correcoes de seguranca que o Debian ja publicou e a imagem do Node ainda nao tem. Sem
# npm/npx/yarn na imagem final, como a API e o egress: o runtime so executa `node`.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY src/server.mjs src/tzsp.mjs ./src/

USER node
ENV NODE_ENV=production PORT=3700 NETCAP_TZSP_PORT=37008 NETCAP_DIR=/data
EXPOSE 3700 37008/udp
CMD ["node", "src/server.mjs"]
