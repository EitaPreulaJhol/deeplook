# Navegador isolado (item 80): a mesma imagem do Playwright dos testes visuais,
# com o Chromium e as dependencias do sistema ja instalados.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

WORKDIR /app
# As correcoes de seguranca que o Ubuntu ja publicou e a imagem do Playwright ainda nao tem (o apt
# da base reprovava no Trivy com duas CVEs altas). O Chromium e o do Playwright, nao o do sistema.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# O npm so instala as dependencias: sai da imagem (o runtime e so node) e leva junto os
# achados do Trivy no npm embutido (undici e brace-expansion; item 6.4). O cache e os logs do
# npm (/root/.npm) tambem: a imagem base do Playwright os traz com um link assinado (SAS) do
# feed da Microsoft, que o scanner de segredos do Trivy acusa, e nada disso serve ao runtime.
RUN npm ci --omit=dev --no-audit --no-fund \
  && rm -rf /usr/lib/node_modules/npm /usr/bin/npm /usr/bin/npx /root/.npm
COPY src ./src

# Usuario sem privilegios da imagem.
USER pwuser
ENV NODE_ENV=production PORT=3100
EXPOSE 3100
CMD ["node", "src/server.mjs"]
