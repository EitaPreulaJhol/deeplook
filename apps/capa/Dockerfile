# Analise de funcoes (item 7.2): capa e FLOSS, da Mandiant (Apache 2.0). Sem rede, sem root e com
# a raiz somente leitura no compose; um container por analise (server.py).
FROM python:3.15-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/
# Wheels de tudo, conferidos pelo hash do lockfile. O binary2strings (do FLOSS) so existe em
# codigo-fonte: o compilador fica neste estagio e nao vai para a imagem final.
RUN pip wheel --no-cache-dir --require-hashes --wheel-dir /wheels -r /tmp/requirements.txt

# Regras e assinaturas FLIRT da mesma versao do capa: o pacote do pip nao as traz. Conferidas pelo
# hash; ao trocar a versao do capa, troque as duas URLs, os hashes e CAPA_RULES_VERSION abaixo.
ADD --checksum=sha256:3d14dbdaf5b71731e42395ed5fa4d287418e6a2e5d6b0a348c7fd9fbe1699611 \
  https://github.com/mandiant/capa-rules/archive/refs/tags/v10.0.0.tar.gz /tmp/rules.tar.gz
ADD --checksum=sha256:d3f6006ad61e6591896f524566c191eca89c6220611969e1bd485bd9a1098180 \
  https://github.com/mandiant/capa/archive/refs/tags/v10.0.0.tar.gz /tmp/capa.tar.gz
RUN mkdir -p /opt/capa \
  && tar xzf /tmp/rules.tar.gz -C /opt/capa \
  && mv /opt/capa/capa-rules-10.0.0 /opt/capa/rules \
  && rm -rf /opt/capa/rules/.github \
  && tar xzf /tmp/capa.tar.gz -C /tmp capa-10.0.0/sigs \
  && mv /tmp/capa-10.0.0/sigs /opt/capa/sigs

FROM python:3.15-slim
# As correcoes de seguranca que o Debian ja publicou e a imagem do Python ainda nao tem.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin capa
# Os wheels ja conferidos no estagio de build (o do binary2strings foi compilado la, entao o hash
# dele nao e o do codigo-fonte que o lockfile registra). Sem rede e sem resolver nada de novo.
COPY --from=build /wheels /wheels
# Depois de instalar, o pip sai da imagem (o runtime so roda python): ele traz vendorizado o
# pkg_resources de um setuptools com CVE alta (o SBOM dele, que o Trivy le), e nada aqui o usa.
# Mesma ideia do npm nas imagens Node (achado D do plano).
RUN pip install --no-cache-dir --no-index --no-deps /wheels/*.whl \
  && rm -rf /wheels \
  && python -m pip uninstall -y -q pip
COPY --from=build /opt/capa /opt/capa
# HOME no /tmp (tmpfs): o vivisect tenta gravar ~/.envi. O cache das regras (o capa o grava em
# XDG_CACHE_HOME na primeira carga) e gerado aqui: com a raiz somente leitura, ele nao conseguiria.
ENV HOME=/tmp \
  XDG_CACHE_HOME=/opt/capa/cache \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3200 \
  CAPA_RULES_VERSION=10.0.0
RUN mkdir /opt/capa/cache \
  && python -c "from pathlib import Path; from capa.rules.cache import generate_rule_cache; assert generate_rule_cache(Path('/opt/capa/rules'), Path('/opt/capa/cache'))" \
  && chmod -R a+rX,go-w /opt/capa
COPY server.py /app/server.py

USER capa
EXPOSE 3200
CMD ["python", "/app/server.py"]
