export interface Env {
  databaseUrl: string;
  bullRedisUrl: string;
  metricsPort: number;
  logLevel: string;
  concurrency: number;
  /** Resend API key. If absent or EMAIL_DISABLED=true, email is a no-op and
   *  quotation_send_log rows land with status=SKIPPED_DEV. Dev/test default. */
  resendApiKey: string | null;
  /** From address — "InstiGenie Quotations <quotations@your-domain.com>". */
  mailFrom: string;
  /** Optional reply-to header (e.g. the sending user's email). Unset by default. */
  mailReplyTo: string | null;
  /** Hard override — when true, never call the provider even if a key is set. */
  emailDisabled: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadEnv(): Env {
  const resendApiKey = process.env.RESEND_API_KEY ?? null;
  const emailDisabled =
    process.env.EMAIL_DISABLED === "true" || resendApiKey === null;
  return {
    databaseUrl: required("DATABASE_URL"),
    bullRedisUrl: required("REDIS_BULL_URL"),
    metricsPort: Number(process.env.WORKER_PORT ?? 4001),
    logLevel: process.env.LOG_LEVEL ?? "info",
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
    resendApiKey,
    mailFrom:
      process.env.MAIL_FROM ?? "InstiGenie <no-reply@instigenie.local>",
    mailReplyTo: process.env.MAIL_REPLY_TO ?? null,
    emailDisabled,
  };
}
