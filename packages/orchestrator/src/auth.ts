/**
 * Auth module — JWT verification for Supabase Auth tokens.
 *
 * Supabase projects may use either:
 *   - ES256 (ECDSA P-256) — verified via JWKS public key from Supabase
 *   - HS256 (HMAC-SHA256) — verified with the project's JWT secret
 *
 * At startup, call `initJwks(supabaseUrl)` to fetch the JWKS and cache
 * the signing key. `verifyJwt()` then supports both algorithms.
 *
 * Dev mode (MAST_DEV_MODE=1 or no jwtSecret/jwks configured):
 *   Hardcoded Phase 1 tokens are accepted alongside JWTs,
 *   mapping to a fixed dev user ID.
 */

import {
  createHmac,
  createVerify,
  createPublicKey,
  timingSafeEqual as cryptoTimingSafeEqual,
  type KeyObject,
} from "node:crypto";

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

interface JwkKey {
  kty: string;
  alg?: string;
  kid?: string;
  use?: string;
  crv?: string;
  x?: string;
  y?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed user ID for dev mode (hardcoded token auth) */
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// JWKS cache
// ---------------------------------------------------------------------------

/** Cached EC public key from Supabase JWKS endpoint */
let cachedPublicKey: KeyObject | null = null;

/**
 * Fetch the JWKS from a Supabase project and cache the signing key.
 * Call once at startup. Logs a warning and continues if fetch fails
 * (falls back to HS256 or dev mode).
 */
export async function initJwks(supabaseUrl: string): Promise<void> {
  const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  try {
    const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`[auth] JWKS fetch failed: ${res.status} ${res.statusText}`);
      return;
    }
    const jwks = (await res.json()) as { keys: JwkKey[] };
    const signingKey = jwks.keys.find(
      (k) => k.kty === "EC" && (k.use === "sig" || !k.use),
    );
    if (!signingKey) {
      console.error("[auth] No EC signing key found in JWKS");
      return;
    }
    cachedPublicKey = createPublicKey({ key: signingKey, format: "jwk" });
    console.log(`[auth] JWKS loaded — ES256 verification enabled (kid: ${signingKey.kid ?? "none"})`);
  } catch (err) {
    console.error("[auth] JWKS fetch error:", err);
  }
}

/**
 * Check whether JWKS-based verification is available.
 */
export function hasJwks(): boolean {
  return cachedPublicKey !== null;
}

// ---------------------------------------------------------------------------
// JWT Verification
// ---------------------------------------------------------------------------

/**
 * Verify a Supabase JWT and return the decoded payload.
 *
 * Supports:
 *   - ES256 (ECDSA P-256) — when JWKS has been loaded via initJwks()
 *   - HS256 (HMAC-SHA256) — when a secret is provided
 *
 * Throws on invalid format, unsupported algorithm, bad signature, or expiry.
 */
export function verifyJwt(token: string, secret?: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to determine algorithm
  const header = JSON.parse(
    Buffer.from(headerB64!, "base64url").toString(),
  ) as { alg: string; typ?: string };

  const data = `${headerB64}.${payloadB64}`;

  if (header.alg === "ES256") {
    if (!cachedPublicKey) {
      throw new Error("ES256 JWT received but no JWKS public key available");
    }
    // ECDSA verification — signature is base64url-encoded
    const sigBuf = Buffer.from(signatureB64!, "base64url");
    const verifier = createVerify("SHA256");
    verifier.update(data);
    if (!verifier.verify({ key: cachedPublicKey, dsaEncoding: "ieee-p1363" }, sigBuf)) {
      throw new Error("Invalid JWT signature");
    }
  } else if (header.alg === "HS256") {
    if (!secret) {
      throw new Error("HS256 JWT received but no secret configured");
    }
    const expectedSig = createHmac("sha256", Buffer.from(secret, "base64"))
      .update(data)
      .digest("base64url");
    if (!timingSafeEqual(expectedSig, signatureB64!)) {
      throw new Error("Invalid JWT signature");
    }
  } else {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
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
