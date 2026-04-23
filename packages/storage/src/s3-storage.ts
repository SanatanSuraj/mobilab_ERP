/**
 * AWS SDK v3 adapter for the ObjectStorage interface.
 *
 * Works against any S3-compatible endpoint. For Phase 4.1a we point it
 * at the local MinIO container (forcePathStyle=true, custom endpoint);
 * in production Phase 4.3 we'll swap to an AWS / MinIO-cluster endpoint
 * with the same code path.
 *
 * Design notes:
 *   - `ensureBucket` is idempotent via HeadBucketCommand — avoids the
 *     403 that CreateBucketCommand throws when the bucket already exists
 *     under a different account.
 *   - `putObject` wraps the body in a Uint8Array copy to guard against
 *     the "Body is not a stream" v3 footgun when a Buffer spans a shared
 *     ArrayBuffer.
 *   - `getSignedGetUrl` uses `@aws-sdk/s3-request-presigner`. We import
 *     it lazily so the core adapter stays tree-shakeable when callers
 *     never sign URLs (e.g. the pdf-render processor only writes).
 */

import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type {
  HeadObjectResult,
  ObjectStorage,
  PutObjectInput,
} from "./types.js";

export interface S3ObjectStorageOptions {
  endpoint: string; // e.g. "http://localhost:9000"
  region?: string; // MinIO ignores; default "us-east-1"
  accessKeyId: string;
  secretAccessKey: string;
  /** Required for MinIO / Ceph; defaults to true. */
  forcePathStyle?: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(opts: S3ObjectStorageOptions) {
    const cfg: S3ClientConfig = {
      endpoint: opts.endpoint,
      region: opts.region ?? "us-east-1",
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: opts.forcePathStyle ?? true,
    };
    this.client = new S3Client(cfg);
  }

  async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      return;
    } catch (err) {
      // 404 = not found → create; any other error propagates.
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status !== 404 && status !== 301 && status !== 403) throw err;
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err) {
      // Race: someone else created it between Head and Create. Treat as success.
      const name = (err as { name?: string })?.name ?? "";
      if (
        name === "BucketAlreadyOwnedByYou" ||
        name === "BucketAlreadyExists"
      ) {
        return;
      }
      throw err;
    }
  }

  async putObject(input: PutObjectInput): Promise<{ etag: string }> {
    const body = Buffer.isBuffer(input.body)
      ? new Uint8Array(input.body.buffer, input.body.byteOffset, input.body.byteLength)
      : input.body;
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: body,
        ContentType: input.contentType,
        ...(input.metadata ? { Metadata: input.metadata } : {}),
      }),
    );
    return { etag: (result.ETag ?? "").replace(/"/g, "") };
  }

  async headObject(bucket: string, key: string): Promise<HeadObjectResult> {
    try {
      const r = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        exists: true,
        ...(r.ContentLength !== undefined ? { size: r.ContentLength } : {}),
        ...(r.ETag !== undefined
          ? { etag: r.ETag.replace(/"/g, "") }
          : {}),
        ...(r.LastModified ? { lastModified: r.LastModified } : {}),
        ...(r.ContentType ? { contentType: r.ContentType } : {}),
        ...(r.Metadata ? { metadata: r.Metadata } : {}),
      };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) return { exists: false };
      throw err;
    }
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!r.Body) throw new Error(`S3 GET ${bucket}/${key} returned no body`);
    // Body is a Node Readable in Node runtime; AWS SDK exposes
    // transformToByteArray() which handles all runtime variants.
    const bytes = await r.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async getSignedGetUrl(
    bucket: string,
    key: string,
    expiresSeconds: number,
  ): Promise<string> {
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: expiresSeconds },
    );
  }
}
