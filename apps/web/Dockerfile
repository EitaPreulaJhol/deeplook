FROM node:26-slim AS build
WORKDIR /app

# Versoes exatas do lockfile: o npm ci falha se ele divergir do package.json.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Sem root (item 6.5): o nginx-unprivileged escuta na 8080 e roda como o usuario 101. A
# variante -slim nao traz os modulos xslt, image-filter e geoip (nem as bibliotecas que
# eles puxam: libxml2, libtiff, libpng...), que um SPA com proxy nao usa. O Trivy contou 62
# achados de severidade alta ou critica, com correcao, na nginx:1.27-alpine, e 8 nesta.
FROM nginxinc/nginx-unprivileged:1.31-alpine-slim

# As imagens do nginx demoram a ser refeitas depois de uma correcao do Alpine: atualiza os
# pacotes na montagem (com isso o Trivy fecha em zero; o scan semanal avisa se algo escapar).
USER root
RUN apk upgrade --no-cache
USER 101

# O nginx.conf e um modelo: na subida, o entrypoint da imagem troca o REAL_IP_FROM (e so ele:
# o filtro deixa as variaveis do proprio nginx, como $uri, em paz) e grava o resultado em /tmp, o
# unico lugar gravavel com a raiz somente leitura. O default.conf da imagem passa a so incluir
# esse arquivo (COPY grava como root, qualquer que seja o USER).
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY nginx-include.conf /etc/nginx/conf.d/default.conf
# Padrao: o gateway da rede `deeplook` do compose (DEEPLOOK_SUBNET), por onde chega o cloudflared
# do host. O compose repassa o REAL_IP_FROM do .env.
ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp \
  NGINX_ENVSUBST_FILTER=^REAL_IP_FROM$ \
  REAL_IP_FROM=172.31.250.1
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
