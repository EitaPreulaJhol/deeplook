# Descompilacao de bytecode Python (plans/analise-estatica-ampliada, item 15): pycdc e pycdas
# (Decompyle++, GPL-3.0, de Michael Hansen), isolados num servico proprio. Sem rede, sem root e com a
# raiz somente leitura no compose; um container por analise (server.py). Nada e executado: o pycdc so
# le o bytecode.
FROM debian:trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git cmake g++ make python3
# Sem release com tag: o commit fixo (o git confere o conteudo pelo hash).
ARG PYCDC_COMMIT=b4289760970dbc399684f1e155ec6d1ea1cc787e
RUN git clone --filter=blob:none https://github.com/zrax/pycdc.git /src \
  && cd /src && git checkout --quiet "$PYCDC_COMMIT" \
  && cmake -DCMAKE_BUILD_TYPE=Release -S . -B build && cmake --build build -j"$(nproc)" \
  && mkdir -p /opt/pycdc && cp build/pycdc build/pycdas LICENSE /opt/pycdc/

FROM python:3.14-slim
# As correcoes de seguranca que o Debian ja publicou e a imagem do Python ainda nao tem.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10014 --no-create-home --shell /usr/sbin/nologin pydec \
  && python -m pip uninstall -y -q pip
COPY --from=build /opt/pycdc /opt/pycdc
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=4200
COPY server.py analyze.py /app/

USER pydec
EXPOSE 4200
CMD ["python", "/app/server.py"]
