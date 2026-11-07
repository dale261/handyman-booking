/**
 * Customers who give only a name and a phone number.
 *
 * Every account needs an email address underneath (that is how sign-in and the
 * database identify people), so a phone-only customer gets a stand-in address on a
 * reserved domain that can never receive mail. The app treats it as "no email":
 * nothing is sent to it, it is never shown, and the owner texts the customer their
 * link instead.
 */
export const NO_EMAIL_DOMAIN = "no-email.invalid";

/** Just the digits of a phone number, for matching and for the stand-in address. */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** The stand-in address for a customer with no email, built from their phone number. */
export function placeholderEmail(phone: string): string {
  return `phone-${phoneDigits(phone)}@${NO_EMAIL_DOMAIN}`;
}

/** True for a stand-in address (or a blank), meaning there is no real email to send to. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  const value = (email ?? "").trim().toLowerCase();
  return value === "" || value.endsWith(`@${NO_EMAIL_DOMAIN}`);
}

/** The address to show or send to: blank when the customer has none. */
export function realEmail(email: string | null | undefined): string {
  return isPlaceholderEmail(email) ? "" : (email ?? "").trim();
}
