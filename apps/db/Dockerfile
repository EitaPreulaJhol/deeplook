# Banco do compose. A imagem oficial (pinada por digest) atrasa em relacao ao Alpine: o
# libxml2 2.13.9-r3 saiu no v3.24/main em 20/11 e o rebuild oficial do Postgres de 22/11
# ainda trazia o r2. O apk upgrade na montagem pega a correcao, como o web e a API ja fazem;
# o Trivy semanal continua sendo a rede de seguranca.
FROM postgres:16-alpine@sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d

# A imagem oficial roda como root e o entrypoint larga o root com o gosu; o upgrade nao muda
# isso. Sem COPY: o contexto e vazio de proposito.
RUN apk upgrade --no-cache
