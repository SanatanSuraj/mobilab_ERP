/**
 * Narrow storage-client interface used by the PDF worker + other Phase 4+
 * consumers. Every method returns the minimum shape the callers need —
 * vendor-specific response envelopes are hidden inside the adapter.
 */

export interface PutObjectInput {
  bucket: string;
  key: string;
  body: Buffer;
  /** MIME type — stored on the object so browsers can preview. */
  contentType: string;
  /** Optional opaque metadata map written as S3 user metadata. */
  metadata?: Record<string, string>;
}

export interface HeadObjectResult {
  exists: boolean;
  size?: number;
  etag?: string;
  lastModified?: Date;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ObjectStorage {
  /** Ensures a bucket exists — safe to call repeatedly. */
  ensureBucket(bucket: string): Promise<void>;

  /** Uploads an object. Overwrites silently if the key already exists —
   * idempotency is the caller's responsibility (see pdf_render_runs). */
  putObject(input: PutObjectInput): Promise<{ etag: string }>;

  /** Checks whether an object exists without downloading it. `exists:false`
   * on 404; any other error is thrown. */
  headObject(bucket: string, key: string): Promise<HeadObjectResult>;

  /** Downloads an object to a Buffer. Throws on 404. Primarily used in
   * gate tests to assert round-trip. */
  getObject(bucket: string, key: string): Promise<Buffer>;

  /** Produces a presigned GET URL. Optional in the interface because
   * MemoryObjectStorage can't satisfy it; production PDF download
   * endpoints call S3ObjectStorage.getSignedGetUrl directly. */
  getSignedGetUrl?(
    bucket: string,
    key: string,
    expiresSeconds: number,
  ): Promise<string>;
}
