# One-shot Postgres backup runner: pg_dump (major version matched to the server)
# piped straight to S3/R2 via rclone — no local disk. NOT a long-running service;
# invoked via `docker compose --profile backup run --rm backup [label]`.
# curl is for the optional BACKUP_PING_URL dead-man's-switch.
FROM postgres:17-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends rclone curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY docker/backup/rclone-env.sh /usr/local/bin/rclone-env.sh
COPY docker/backup/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

ENTRYPOINT ["/usr/local/bin/backup.sh"]
