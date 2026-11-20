# Modelos de aprendizado de maquina (plans/analise-estatica-ampliada, itens 26 e 29): o StringSifter
# (Apache-2.0, Mandiant) ordena strings, e o modelo de PE do EMBER2024 (Apache-2.0) da uma pontuacao
# informativa. Sem rede, sem root e com a raiz somente leitura no compose; um container por pedido.
# Python 3.11: o StringSifter fixa o numpy 1.24, que nao tem wheel para versoes mais novas.
FROM python:3.11-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates
COPY requirements-sifter.txt requirements-ember.txt /tmp/
# Um ambiente por modelo (o lightgbm 3 do StringSifter e o 4 do EMBER2024 nao convivem), com os
# pacotes conferidos pelo hash do lockfile.
RUN python -m venv /opt/sifter \
  && /opt/sifter/bin/pip install --no-cache-dir --require-hashes -r /tmp/requirements-sifter.txt \
  && python -m venv /opt/ember \
  && /opt/ember/bin/pip install --no-cache-dir --require-hashes -r /tmp/requirements-ember.txt
# O thrember (os atributos do EMBER v3) do commit fixo, sem as dependencias de treino; o git confere o
# conteudo pelo hash do commit.
ARG THREMBER_COMMIT=0ef753e81d98bf209f71b03cd331dfc190b5b54d
RUN git clone --filter=blob:none https://github.com/FutureComputing4AI/EMBER2024.git /src \
  && cd /src && git checkout --quiet "$THREMBER_COMMIT" \
  && /opt/ember/bin/pip install --no-cache-dir --no-deps /src
# O modelo de PE do benchmark do EMBER2024, na revisao fixa do HuggingFace, conferido pelo SHA-256.
ADD --checksum=sha256:4252027863492ac138785c8c18576f43dad77d00faddc14e8c0072e8db419f99 \
  https://huggingface.co/joyce8/EMBER2024-benchmark-models/resolve/e5b945dd90e1a1a1ec0cc07b3a17b52e9ba2d0c2/EMBER2024_PE.model \
  /opt/ember-models/EMBER2024_PE.model

FROM python:3.11-slim
# O LightGBM pede o OpenMP; as correcoes de seguranca que o Debian ja publicou.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10015 --no-create-home --shell /usr/sbin/nologin ml \
  && python -m pip uninstall -y -q pip
COPY --from=build /opt/sifter /opt/sifter
COPY --from=build /opt/ember /opt/ember
COPY --from=build --chmod=644 /opt/ember-models /opt/ember-models
RUN chmod 755 /opt/ember-models
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=4300
COPY server.py rank.py ember.py /app/

USER ml
EXPOSE 4300
CMD ["python", "/app/server.py"]
