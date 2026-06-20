/**
 * YouTopia Server — Token / PIN auth.
 *
 * Aligned with companion-server api-shared/auth.ts patterns:
 *  - PIN-based login (4+ digit PIN hashed with SHA-256).
 *  - Random bearer tokens, stored as SHA-256 hashes server-side.
 *  - Multi-user: Patrick + spouse each have independent tokens.
 *  - No Electron safeStorage dependency — tokens held in memory (Map) during
 *    the process lifetime.  For persistence across restarts, persist the
 *    token store to the dataDir (future enhancement).
 *
 * CONTRACT NOTES for PM:
 *  - The contracts/session.ts User type has userId + displayName only.
 *    We track tokens and PINs locally here without extending the contract.
 */

import crypto from "node:crypto";
import { getConfig } from "../config/index.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Types (local — not in contracts)
// ---------------------------------------------------------------------------

export interface TokenEntry {
  tokenId: string;
  userId: string;
  /** SHA-256 of the raw bearer token. */
  tokenHash: string;
  issuedAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// In-memory token store
// ---------------------------------------------------------------------------

const tokenStore = new Map<string, TokenEntry>(); // tokenId -> entry

// ---------------------------------------------------------------------------
// PIN validation
// ---------------------------------------------------------------------------

/** Returns userId if the PIN matches a configured user, otherwise null. */
export function validatePin(userId: string, pin: string): string | null {
  const cfg = getConfig();
  const user = cfg.auth.users.find((u) => u.userId === userId);
  if (!user) return null;

  const pinHash = crypto.createHash("sha256").update(pin).digest("hex");
  if (pinHash !== user.pinHash) return null;

  return user.userId;
}

// ---------------------------------------------------------------------------
// Token lifecycle
// ---------------------------------------------------------------------------

/** Issues a new bearer token for the given userId. Returns the raw token. */
export function issueToken(userId: string): string {
  const cfg = getConfig();
  const rawToken = crypto.randomBytes(64).toString("hex");
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  const tokenId = crypto.randomUUID();
  const now = Date.now();

  const entry: TokenEntry = {
    tokenId,
    userId,
    tokenHash,
    issuedAt: now,
    expiresAt: now + cfg.auth.tokenTtlSeconds * 1000,
  };

  // Remove any existing tokens for this user
  for (const [id, e] of tokenStore.entries()) {
    if (e.userId === userId) {
      tokenStore.delete(id);
    }
  }

  tokenStore.set(tokenId, entry);
  logger.debug({ userId, tokenId }, "Token issued");
  return rawToken;
}

/**
 * Verifies a bearer token.
 * Returns `{ valid: true, userId, tokenId }` or `{ valid: false }`.
 */
export function verifyToken(
  rawToken: string
): { valid: true; userId: string; tokenId: string } | { valid: false } {
  if (!rawToken) return { valid: false };

  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  const now = Date.now();

  for (const entry of tokenStore.values()) {
    if (entry.tokenHash === tokenHash) {
      if (entry.expiresAt < now) {
        tokenStore.delete(entry.tokenId);
        return { valid: false };
      }
      return { valid: true, userId: entry.userId, tokenId: entry.tokenId };
    }
  }

  return { valid: false };
}

/** Revokes a token by its raw value. */
export function revokeToken(rawToken: string): void {
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  for (const [id, entry] of tokenStore.entries()) {
    if (entry.tokenHash === tokenHash) {
      tokenStore.delete(id);
      logger.debug({ userId: entry.userId }, "Token revoked");
      return;
    }
  }
}

/** Prune expired tokens (call periodically). */
export function pruneExpiredTokens(): void {
  const now = Date.now();
  for (const [id, entry] of tokenStore.entries()) {
    if (entry.expiresAt < now) tokenStore.delete(id);
  }
}
