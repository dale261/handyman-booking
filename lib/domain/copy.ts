/** Shown anywhere a customer would otherwise see a low–high estimate. */
export const REVIEW_WAIT =
  "We're reviewing this and will send you a firm price, usually within 1 business day. You'll approve it before anything is booked or paid.";

/** Shown next to a price the customer can approve or pay. */
export const LOCKED_PRICE =
  "This is your price. It won't change unless we find something on site that's different from what you described, and we won't start any different work without your OK.";

/** Short add-on for the home page and the before-work cancel note. */
export const ON_SITE_TERMS =
  "If we find something different on site, you can approve a new price or get refunded everything except travel.";

/** Customer jobs list. Review and referral rows never include a dollar range. */
export function customerListPrice(status: string, total: number, usd: (n: number) => string): string {
  if (status === "scope_review") return "Firm price after we review it";
  if (status === "referred") return "";
  return usd(total);
}
