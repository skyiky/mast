/**
 * Auth module — JWT verification for Supabase Auth tokens.
 *
 * Supabase issues HS256 JWTs signed with the project's JWT secret.
 * This module verifies those tokens without external dependencies
 * (uses Node.js built-in crypto).
 *
 * Dev mode (MAST_DEV_MODE=1 or no jwtSecret configured):
 *   Hardcoded Phase 1 tokens are accepted alongside JWTs,
 *   mapping to a fixed dev user ID.
 */

import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JwtPayload {
  /** Subject — Supabase user UUID */
  sub: string;
  /** Expiration time (Unix seconds) */
  exp?: number;
  /** Issued at (Unix seconds) */
  iat?: number;
  /** Issuer */
  iss?: string;
  /** Role (e.g. "authenticated") */
  role?: string;
  /** Email */
  email?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed user ID for dev mode (hardcoded token auth) */
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// JWT Verification
// ---------------------------------------------------------------------------

/**
 * Verify a Supabase JWT (HS256) and return the decoded payload.
 * Throws on invalid format, unsupported algorithm, bad signature, or expiry.
 */
export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to verify algorithm
  const header = JSON.parse(
    Buffer.from(headerB64!, "base64url").toString(),
  ) as { alg: string; typ?: string };

  if (header.alg !== "HS256") {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
  }

  // Verify HMAC-SHA256 signature
  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac("sha256", secret)
    .update(data)
    .digest("base64url");

  if (!timingSafeEqual(expectedSig, signatureB64!)) {
    throw new Error("Invalid JWT signature");
  }

  // Decode payload
  const payload = JSON.parse(
    Buffer.from(payloadB64!, "base64url").toString(),
  ) as JwtPayload;

  // Check expiry (with 30s clock skew tolerance)
  if (payload.exp && payload.exp < Date.now() / 1000 - 30) {
    throw new Error("JWT expired");
  }

  if (!payload.sub) {
    throw new Error("JWT missing sub claim");
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison to prevent timing attacks on signature.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return cryptoTimingSafeEqual(bufA, bufB);
}
