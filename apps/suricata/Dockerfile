# Suricata sobre o pcap do sandbox (plano pos-revisao, item 5.4): o pacote do Debian (OISF, GPLv2)
# e o suricata-update para as regras ET Open. Sem root e com a raiz somente leitura no compose; um
# container por analise (server.py). As regras ficam num volume (/var/lib/suricata), atualizadas
# pela saida controlada (egress).
FROM debian:trixie-slim
# As correcoes de seguranca que o Debian ja publicou e a imagem ainda nao tem.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends suricata suricata-update ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10007 --no-create-home --shell /usr/sbin/nologin suricata \
  && mkdir -p /var/lib/suricata/rules /var/lib/suricata/update \
  && chown -R suricata:suricata /var/lib/suricata
ENV HOME=/tmp \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PORT=3800
COPY server.py deeplook.rules /app/

USER suricata
EXPOSE 3800
CMD ["python3", "/app/server.py"]
