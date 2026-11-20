# Modelos de aprendizado de maquina (plans/analise-estatica-ampliada, itens 26 e 29): o StringSifter
# (Apache-2.0, Mandiant) ordena strings, e o modelo de PE do EMBER2024 (Apache-2.0) da uma pontuacao
# informativa. Sem rede, sem root e com a raiz somente leitura no compose; um container por pedido.
# Python 3.11: o StringSifter fixa o numpy 1.24, que nao tem wheel para versoes mais novas.
FROM python:3.11-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates
COPY requirements-sifter.txt requirements-stringsifter.txt requirements-ember.txt /tmp/
# Um ambiente por modelo (o numpy 1.24 do StringSifter e o 2 do EMBER2024 nao convivem), com os
# pacotes conferidos pelo hash do lockfile.
RUN python -m venv /opt/sifter \
  && /opt/sifter/bin/pip install --no-cache-dir --require-hashes -r /tmp/requirements-sifter.txt \
  && /opt/sifter/bin/pip install --no-cache-dir --require-hashes --no-deps \
    -r /tmp/requirements-stringsifter.txt \
  && python -m venv /opt/ember \
  && /opt/ember/bin/pip install --no-cache-dir --require-hashes -r /tmp/requirements-ember.txt
# O thrember (os atributos do EMBER v3) do commit fixo, sem as dependencias de treino; o git confere o
# conteudo pelo hash do commit.
ARG THREMBER_COMMIT=0ef753e81d98bf209f71b03cd331dfc190b5b54d
RUN git clone --filter=blob:none https://github.com/FutureComputing4AI/EMBER2024.git /src \
  && cd /src && git checkout --quiet "$THREMBER_COMMIT" \
  && /opt/ember/bin/pip install --no-cache-dir --no-deps /src
# O features.py foi escrito para o signify 0.7; o 0.9.2 (sem o CVE-2025-70887) renomeou a leitura das
# assinaturas e devolve os certificados num CertificateStore. Os atributos saem iguais (conferido nos
# PE de teste, assinados e nao). O grep falha o build se o commit mudar e a troca nao se aplicar.
RUN f=/opt/ember/lib/python3.11/site-packages/thrember/features.py \
  && sed -i \
    -e 's/^from signify.authenticode import SignedPEFile$/from signify.authenticode.signed_file.pe import SignedPEFile/' \
    -e 's/signed_pe.iter_signed_datas()/signed_pe.iter_embedded_signatures()/' \
    -e 's/certs = signed_data.certificates$/certs = list(signed_data.certificates)/' "$f" \
  && grep -q '^from signify.authenticode.signed_file.pe import SignedPEFile$' "$f" \
  && grep -q 'iter_embedded_signatures()' "$f" \
  && grep -q 'certs = list(signed_data.certificates)$' "$f"
# Nada de instalar depois daqui: o pip, o setuptools e o wheel dos ambientes saem (o setuptools traz
# copias velhas de pacotes com CVE, e nada os usa em execucao).
RUN for v in /opt/sifter /opt/ember; do \
    $v/bin/python -m pip uninstall -y -q setuptools wheel pip 2>/dev/null; \
    rm -rf $v/lib/python3.11/site-packages/setuptools $v/lib/python3.11/site-packages/pkg_resources \
      $v/lib/python3.11/site-packages/_distutils_hack; \
  done
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
  && python -m pip uninstall -y -q setuptools wheel pip
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
