/**
 * Wire shapes for the /auth/forgot-password and /auth/reset-password flow.
 *
 * Three endpoints:
 *   POST /auth/forgot-password           — body: { email }
 *                                          response: always 200 { ok: true }
 *                                          (no leak of which emails exist)
 *   GET  /auth/reset-password/preview    — query: ?token=<raw-hex>
 *                                          response: { email, expiresAt }
 *                                          404 if token is unknown / expired / consumed
 *   POST /auth/reset-password            — body: { token, newPassword }
 *                                          response: { ok: true }
 *
 * Token shape: 64 hex chars (32 bytes of crypto-random). Validated cheaply
 * by length/charset on the wire so we don't hash + lookup garbage.
 */

import { z } from "zod";

const RawTokenSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "invalid reset token");

// Mirrors the invite-accept policy. Bumping the floor is cheap, but anything
// here must also be enforced at the bcrypt step in the service.
const NewPasswordSchema = z
  .string()
  .min(10, "password must be at least 10 characters")
  .max(128, "password is too long");

// ─── Forgot password ─────────────────────────────────────────────────────

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ForgotPasswordResponseSchema = z.object({
  ok: z.literal(true),
});
export type ForgotPasswordResponse = z.infer<typeof ForgotPasswordResponseSchema>;

// ─── Reset preview ───────────────────────────────────────────────────────

export const ResetPasswordPreviewQuerySchema = z.object({
  token: RawTokenSchema,
});
export type ResetPasswordPreviewQuery = z.infer<
  typeof ResetPasswordPreviewQuerySchema
>;

export const ResetPasswordPreviewResponseSchema = z.object({
  email: z.string().email(),
  expiresAt: z.string(), // ISO-8601
});
export type ResetPasswordPreviewResponse = z.infer<
  typeof ResetPasswordPreviewResponseSchema
>;

// ─── Reset commit ────────────────────────────────────────────────────────

export const ResetPasswordRequestSchema = z.object({
  token: RawTokenSchema,
  newPassword: NewPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const ResetPasswordResponseSchema = z.object({
  ok: z.literal(true),
});
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponseSchema>;
