# Office e PDF mais fundo (item 7.14; revisao de novembro, 3.2): oletools (BSD-2), de Philippe Lagadec.
# Sem rede, sem root e com a raiz somente leitura no compose; um container por analise (server.py).
FROM python:3.12-slim AS build
COPY requirements.txt /tmp/
# Wheels de tudo, conferidos pelo hash do lockfile.
RUN pip wheel --no-cache-dir --require-hashes --wheel-dir /wheels -r /tmp/requirements.txt

FROM python:3.12-slim
# As correcoes de seguranca que o Debian ja publicou e a imagem do Python ainda nao tem.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10004 --no-create-home --shell /usr/sbin/nologin oletools
COPY --from=build /wheels /wheels
# Depois de instalar, o pip sai da imagem (como no capa): o runtime so roda python.
RUN pip install --no-cache-dir --no-index --no-deps /wheels/*.whl \
  && rm -rf /wheels \
  && python -m pip uninstall -y -q pip
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3500
COPY server.py analyze.py qr.py /app/

USER oletools
EXPOSE 3500
CMD ["python", "/app/server.py"]
