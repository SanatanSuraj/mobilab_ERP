/**
 * @instigenie/storage — object-storage client abstraction.
 *
 * ARCHITECTURE.md §4.3 designates MinIO as the object store for PDFs,
 * archived audit-log JSONL, and eventually device-attached artefacts.
 * Locally we run a single-node MinIO container; in production we run a
 * 3-node cluster. Either way callers see the same ObjectStorage
 * interface defined here.
 *
 * Why a custom interface rather than exposing S3Client directly:
 *   - The processor / handler code should be uninterested in S3 details
 *     (multipart uploads, retry semantics, presigned URL quirks). One
 *     narrow interface → easy to fake in gate tests.
 *   - Phase 4.1a uses only put + head + getSignedGetUrl. If Phase 4.3
 *     needs server-side encryption or lifecycle tagging we widen the
 *     interface; callers above stay stable.
 *
 * The concrete adapter lives in `./s3-storage.ts`. A memory adapter for
 * unit tests lives in `./memory-storage.ts`. Gate 39 uses the real S3
 * adapter against the running MinIO container.
 */

export type { ObjectStorage, PutObjectInput, HeadObjectResult } from "./types.js";
export {
  S3ObjectStorage,
  type S3ObjectStorageOptions,
} from "./s3-storage.js";
export { MemoryObjectStorage } from "./memory-storage.js";
export { buildQcCertKey } from "./keys.js";
