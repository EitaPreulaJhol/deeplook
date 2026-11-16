# APK/Android (plans/novas-analises, item 6): androguard (Apache-2.0).
# Sem rede, sem root e com a raiz somente leitura no compose; um container por analise (server.py).
FROM python:3.14-slim AS build
COPY requirements.txt /tmp/
# Wheels de tudo, conferidos pelo hash do lockfile.
RUN pip wheel --no-cache-dir --require-hashes --wheel-dir /wheels -r /tmp/requirements.txt

FROM python:3.14-slim
# As correcoes de seguranca que o Debian ja publicou e a imagem do Python ainda nao tem.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10009 --no-create-home --shell /usr/sbin/nologin android
COPY --from=build /wheels /wheels
# Depois de instalar, o pip sai da imagem (como no capa): o runtime so roda python.
RUN pip install --no-cache-dir --no-index --no-deps /wheels/*.whl \
  && rm -rf /wheels \
  && python -m pip uninstall -y -q pip
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3700
COPY server.py analyze.py /app/

USER android
EXPOSE 3700
CMD ["python", "/app/server.py"]
