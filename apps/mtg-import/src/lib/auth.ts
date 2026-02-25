import { timingSafeEqual } from "crypto";

/**
 * Timing-safe comparison of Bearer token against expected secret.
 * Prevents timing side-channel attacks on cron endpoint authentication.
 */
export function verifyBearerToken(
  authHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!authHeader || !secret) return false;

  const expected = `Bearer ${secret}`;

  if (authHeader.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
}
