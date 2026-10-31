# Navegador isolado (item 80): a mesma imagem do Playwright dos testes visuais,
# com o Chromium e as dependencias do sistema ja instalados.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src

# Usuario sem privilegios da imagem.
USER pwuser
ENV NODE_ENV=production PORT=3100
EXPOSE 3100
CMD ["node", "src/server.mjs"]
