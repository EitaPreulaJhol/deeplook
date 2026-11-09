# Desempacotar e extrair (item 7.8): upx, 7-Zip, innoextract e pyinstxtractor. Sem rede, sem root e
# com a raiz somente leitura no compose; um container por trabalho (server.py). Nada e executado.
FROM debian:trixie-slim AS fetch
# pyinstxtractor 2026.07 (GPL-3.0), um script so, sem dependencias, no commit exato da versao.
ADD --checksum=sha256:94e0b6c9d5151bbeefc7e7452e96e24b396c2dbfcb0348e5f12c4c0865fefe58 \
  https://raw.githubusercontent.com/extremecoders-re/pyinstxtractor/815d31cf26bc71e62f851b2e549452e7b7c9dd98/pyinstxtractor.py \
  /opt/pyinstxtractor/pyinstxtractor.py

FROM debian:trixie-slim
# upx 4.2, 7-Zip 25 (abre NSIS, ZIP, 7z, RAR, CAB e autoextraiveis) e innoextract 1.9 (Inno Setup
# ate a 6.2). As correcoes de seguranca que o Debian ja publicou entram pelo upgrade.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends upx-ucl 7zip innoextract python3 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10003 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin unpack
# 755: o --chmod vale tambem para a pasta, que sem o x nao se atravessa.
COPY --from=fetch --chmod=755 /opt/pyinstxtractor /opt/pyinstxtractor
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3400
COPY server.py /app/server.py
COPY unpackers /app/unpackers

USER unpack
EXPOSE 3400
CMD ["python3", "/app/server.py"]
