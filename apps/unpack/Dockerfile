# Identificar e desempacotar (itens 7.8 e 7.9): Detect It Easy, upx, 7-Zip, innoextract e
# pyinstxtractor. Sem rede, sem root e com a raiz somente leitura no compose; um container por
# trabalho (server.py). Nada e executado.
FROM debian:trixie-slim AS fetch
# pyinstxtractor 2026.07 (GPL-3.0), um script so, sem dependencias, no commit exato da versao.
ADD --checksum=sha256:94e0b6c9d5151bbeefc7e7452e96e24b396c2dbfcb0348e5f12c4c0865fefe58 \
  https://raw.githubusercontent.com/extremecoders-re/pyinstxtractor/815d31cf26bc71e62f851b2e549452e7b7c9dd98/pyinstxtractor.py \
  /opt/pyinstxtractor/pyinstxtractor.py
# Detect It Easy 3.21 (MIT), o pacote oficial para Debian 13, conferido pelo SHA-256 publicado. So o
# diec (linha de comando) e o banco de assinaturas: a interface grafica, as imagens, os idiomas e o
# resto ficam de fora. O pacote pede o Qt5 inteiro; o diec so carrega o Core e o Script (ldd).
ADD --checksum=sha256:47ed1299fe0fcdf3549e4077573db9651c228144b22a372729eb014548332fcd \
  https://github.com/horsicq/DIE-engine/releases/download/3.21/die_3.21_Debian_13_amd64.deb \
  /tmp/die.deb
RUN dpkg-deb -x /tmp/die.deb /tmp/die \
  && mkdir -p /opt/die/usr/bin /opt/die/usr/lib/die \
  && cp /tmp/die/usr/bin/diec /opt/die/usr/bin/ \
  && cp -r /tmp/die/usr/lib/die/db /tmp/die/usr/lib/die/db_custom /opt/die/usr/lib/die/

FROM debian:trixie-slim
# upx 4.2, 7-Zip 25 (abre NSIS, ZIP, 7z, RAR, CAB e autoextraiveis) e innoextract 1.9 (Inno Setup
# ate a 6.2). As correcoes de seguranca que o Debian ja publicou entram pelo upgrade.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends upx-ucl 7zip innoextract python3 \
    libqt5core5t64 libqt5script5 libglib2.0-0t64 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10003 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin unpack
# 755: o --chmod vale tambem para a pasta, que sem o x nao se atravessa.
COPY --from=fetch --chmod=755 /opt/pyinstxtractor /opt/pyinstxtractor
COPY --from=fetch /opt/die/ /
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3400
COPY server.py /app/server.py
COPY unpackers /app/unpackers

USER unpack
EXPOSE 3400
CMD ["python3", "/app/server.py"]
