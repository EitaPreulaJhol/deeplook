# Navegador isolado (item 80): a mesma imagem do Playwright dos testes visuais,
# com o Chromium e as dependencias do sistema ja instalados.
FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock
COPY src ./src

# Usuario sem privilegios da imagem.
USER pwuser
ENV NODE_ENV=production PORT=3100
EXPOSE 3100
CMD ["node", "src/server.mjs"]
