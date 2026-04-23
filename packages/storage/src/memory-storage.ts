/**
 * In-memory ObjectStorage used by unit tests that don't want to spin
 * MinIO. Gate 39 uses the real S3 adapter — this is for lower-layer
 * tests (e.g. the PDF processor's own tests).
 */

import type { HeadObjectResult, ObjectStorage, PutObjectInput } from "./types.js";

interface StoredObject {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
  etag: string;
  lastModified: Date;
}

function fakeEtag(b: Buffer): string {
  // Cheap deterministic etag-ish string. Not MD5, not meant to match S3
  // exactly — callers only check stability across re-puts.
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b[i]!) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}

export class MemoryObjectStorage implements ObjectStorage {
  private readonly buckets = new Map<string, Map<string, StoredObject>>();

  async ensureBucket(bucket: string): Promise<void> {
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map());
  }

  async putObject(input: PutObjectInput): Promise<{ etag: string }> {
    await this.ensureBucket(input.bucket);
    const etag = fakeEtag(input.body);
    this.buckets.get(input.bucket)!.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      metadata: input.metadata ?? {},
      etag,
      lastModified: new Date(),
    });
    return { etag };
  }

  async headObject(bucket: string, key: string): Promise<HeadObjectResult> {
    const obj = this.buckets.get(bucket)?.get(key);
    if (!obj) return { exists: false };
    return {
      exists: true,
      size: obj.body.length,
      etag: obj.etag,
      lastModified: obj.lastModified,
      contentType: obj.contentType,
      metadata: obj.metadata,
    };
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const obj = this.buckets.get(bucket)?.get(key);
    if (!obj) {
      const err = new Error(`MemoryObjectStorage 404: ${bucket}/${key}`);
      (err as { $metadata?: { httpStatusCode: number } }).$metadata = {
        httpStatusCode: 404,
      };
      throw err;
    }
    return Buffer.from(obj.body);
  }
}
