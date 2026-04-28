export interface Env {
  databaseUrl: string;
  bullRedisUrl: string;
  metricsPort: number;
  logLevel: string;
  concurrency: number;
  /**
   * SMTP backend (Nodemailer). When SMTP_HOST is set, the mailer prefers
   * SMTP over Resend — the typical "send from Gmail/Workspace via App
   * Password" path that doesn't require domain verification.
   */
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string | null;
    password: string | null;
  } | null;
  /** Resend API key. Used only when smtp is null. If both are absent or
   *  EMAIL_DISABLED=true, email is a no-op (SKIPPED_DEV). */
  resendApiKey: string | null;
  /** From address — "Mobilab ERP <noreply@your-domain.com>". */
  mailFrom: string;
  /** Optional reply-to header (e.g. the sending user's email). Unset by default. */
  mailReplyTo: string | null;
  /** Hard override — when true, never call any provider even if configured. */
  emailDisabled: boolean;
  /**
   * MinIO / S3 endpoint, e.g. "http://localhost:9000" for the local dev
   * container. Phase 4.1a uses this to persist rendered PDFs.
   */
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  /** Bucket for rendered PDFs (ARCHITECTURE.md §4.1). */
  pdfBucket: string;
  /** Brand name rendered in the PDF header. Default "InstiGenie". */
  brandName: string;
  /**
   * Public origin of the web app — used by the user-invite-created
   * handler when rendering the accept-invite URL. Mirrors apps/api's
   * WEB_ORIGIN so the email link lands on the customer-visible host.
   */
  webOrigin: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function loadSmtp(): Env["smtp"] {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    // Most providers want STARTTLS on 587 (secure=false) and implicit TLS
    // on 465 (secure=true). Default by port; allow explicit override.
    secure:
      process.env.SMTP_SECURE !== undefined
        ? process.env.SMTP_SECURE === "true"
        : Number(process.env.SMTP_PORT ?? 587) === 465,
    user: process.env.SMTP_USER ?? null,
    password: process.env.SMTP_PASSWORD ?? null,
  };
}

export function loadEnv(): Env {
  const smtp = loadSmtp();
  const resendApiKey = process.env.RESEND_API_KEY ?? null;
  const hasProvider = smtp !== null || resendApiKey !== null;
  const emailDisabled =
    process.env.EMAIL_DISABLED === "true" || !hasProvider;
  return {
    databaseUrl: required("DATABASE_URL"),
    bullRedisUrl: required("REDIS_BULL_URL"),
    metricsPort: Number(process.env.WORKER_PORT ?? 4001),
    logLevel: process.env.LOG_LEVEL ?? "info",
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
    smtp,
    resendApiKey,
    mailFrom:
      process.env.MAIL_FROM ?? "InstiGenie <no-reply@instigenie.local>",
    mailReplyTo: process.env.MAIL_REPLY_TO ?? null,
    emailDisabled,
    minioEndpoint: process.env.MINIO_ENDPOINT ?? "http://localhost:9000",
    minioAccessKey: process.env.MINIO_ACCESS_KEY ?? "instigenie",
    minioSecretKey: process.env.MINIO_SECRET_KEY ?? "instigenie_dev_minio",
    pdfBucket: process.env.PDF_BUCKET ?? "instigenie-pdfs",
    brandName: process.env.BRAND_NAME ?? "InstiGenie",
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  };
}
