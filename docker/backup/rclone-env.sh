# Configure an rclone S3 remote ("r2") entirely from env — no config file.
# POSIX sh, sourced by backup.sh AND by manual list/restore commands
# (see the runbook in DEPLOYMENT.md):
#   … --entrypoint sh backup -c '. /usr/local/bin/rclone-env.sh && rclone ls …'
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER="${S3_PROVIDER:-Cloudflare}"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
export RCLONE_CONFIG_R2_ENDPOINT="${S3_ENDPOINT}"
export RCLONE_CONFIG_R2_ACL=private
# Skip rclone's pre-write CreateBucket probe. R2 answers it with AccessDenied
# for bucket-scoped Object R&W tokens (instead of BucketAlreadyOwnedByYou),
# failing every upload. The bucket always pre-exists: minio-init creates it in
# dev/test; prod's R2 bucket is created by hand (DEPLOYMENT.md).
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
