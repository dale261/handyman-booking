export type AiMode = "model" | "fallback" | "capped";

/**
 * No key: keyword and rate-sheet quoting, and unlisted jobs can still book.
 * Key set but the day's reservation was refused: same prices, unlisted jobs wait for the owner.
 * Tests never call the model. A refused reservation in a test is still "capped".
 */
export function aiModeFromReservation(hasKey: boolean, testing: boolean, allowed: boolean | null): AiMode {
  if (!hasKey) return "fallback";
  if (allowed === false) return "capped";
  if (testing) return "fallback";
  return "model";
}
