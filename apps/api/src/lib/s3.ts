import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

/**
 * Thin S3 wrapper for the article archive. Talks to whatever the S3_* env
 * points at — Cloudflare R2 in prod, MinIO in the dev/test stacks and local
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
