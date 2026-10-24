import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { logger } from "./logger.js";
import { env } from "../config/env.js";

/**
 * Thin S3 wrapper for the article archive. Talks to whatever the S3_* env
 * points at — Cloudflare R2 in prod, versitygw in the dev/test stacks and local
 * dev. Path-style addressing works against both, so there is no per-provider
 * branching. Optional by design: when unconfigured, callers skip archiving.
 */

export const s3Configured = Boolean(
  env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
);

let client: S3Client | undefined;

function s3(): S3Client {
  if (!s3Configured) throw new Error("S3 client requested without S3_* configured");
  client ??= new S3Client({
    endpoint: env.S3_ENDPOINT!,
    region: "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
    // Objects are small (≤30 KB archives, ≤200 KB manual pastes); a stalled
    // connection must not hang the admin download or the process endpoint
    // that reads through pageTextFor.
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 },
  });
  return client;
}

/**
 * One-shot reachability probe, logged at boot. `s3Configured` only proves four
 * env strings are non-empty — it says nothing about whether the endpoint
 * answers or the bucket exists. Without this, a wrong `S3_BUCKET` or a gateway
 * that never joined the compose network stays invisible until an editor
 * submits: every archive then burns `ARCHIVE_MAX_ATTEMPTS` over ~15 minutes
 * before settling as `failed`, and the admin pill blames the *page* ("Sivua ei
 * voitu ladata") for what is really a storage outage.
 *
 * Deliberately diagnostic, not a gate: it does NOT disable archiving. The
 * worker's backoff already recovers on its own once storage returns — a capture
 * that failed its first four attempts against a dead gateway succeeded on the
 * fifth once the container was reattached — and latching `archiveEnabled` off
 * at boot would throw that recovery away for the life of the process, on
 * nothing more than a slow-starting dependency.
 */
export async function verifyS3Access(): Promise<boolean> {
  if (!s3Configured) return false;
  try {
    await s3().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    logger.info({ endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET }, "S3 archive storage ready");
    return true;
  } catch (err) {
    // HeadBucket answers a missing bucket with a bodyless 404, which the SDK can
    // only call "UnknownError" — so log the status alongside it: 404 means the
    // bucket, anything else (or none at all, i.e. a DNS/connect failure) means
    // the endpoint or the credentials.
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    logger.error(
      {
        endpoint: env.S3_ENDPOINT,
        bucket: env.S3_BUCKET,
        status,
        err: (err as Error).message,
      },
      "S3 unreachable or bucket missing — archiving will keep failing until this is fixed",
    );
    return false;
  }
}

export async function putTextObject(key: string, body: string): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: key.endsWith(".md")
        ? "text/markdown; charset=utf-8"
        : "text/plain; charset=utf-8",
    }),
  );
}

export async function getTextObject(key: string): Promise<string> {
  const res = await s3().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (!res.Body) throw new Error(`S3 object ${key} has no body`);
  return res.Body.transformToString("utf-8");
}
