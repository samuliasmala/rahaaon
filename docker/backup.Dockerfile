# One-shot Postgres backup runner: pg_dump (major version matched to the server)
# written to the bind-mounted /backups directory on the VPS disk. NOT a
# long-running service; invoked via `docker compose --profile backup run --rm
# backup [label]`. curl is for the optional dead-man's-switch ping.
FROM postgres:17-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY docker/backup/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

ENTRYPOINT ["/usr/local/bin/backup.sh"]
