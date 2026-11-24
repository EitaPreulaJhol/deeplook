# Emulacao de PE e shellcode (plans/novas-analises, item 4): Speakeasy 2.x (MIT), da Mandiant.
# Python 3.11: o 2.x suporta 3.10 a 3.15; a troca de versao fica para outra rodada.
# Sem rede, sem root e com a raiz somente leitura no compose; um container por analise (server.py).
FROM python:3.11-slim AS build
COPY requirements.txt /tmp/
# Wheels de tudo, conferidos pelo hash do lockfile.
RUN pip wheel --no-cache-dir --require-hashes --wheel-dir /wheels -r /tmp/requirements.txt

FROM python:3.11-slim
# As correcoes de seguranca que o Debian ja publicou e a imagem do Python ainda nao tem.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10008 --no-create-home --shell /usr/sbin/nologin emulate
COPY --from=build /wheels /wheels
# Depois de instalar, o pip sai da imagem (como no capa): o runtime so roda python.
RUN pip install --no-cache-dir --no-index --no-deps /wheels/*.whl \
  && rm -rf /wheels \
  && python -m pip uninstall -y -q pip
# O HOME e o /tmp (raiz somente leitura); o setuptools 81 vem do lockfile (ver requirements.in).
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3600
COPY server.py analyze.py /app/

USER emulate
EXPOSE 3600
CMD ["python", "/app/server.py"]
