import type { JobStatus } from "@/lib/db/types";

export const STATUS_LABEL: Record<JobStatus, string> = {
  quoted: "Quote ready",
  scope_review: "We're reviewing this",
  referred: "Referred to someone else",
  pending_area: "Checking the address",
  declined: "Declined",
  held: "Waiting on payment",
  released: "Time released",
  booked: "Booked",
  price_change: "Waiting on your OK for a price change",
  in_progress: "Work in progress",
  awaiting_approval: "Please approve the work",
  disputed: "Problem reported",
  balance_due: "Balance due",
  completed: "Paid and complete",
  reviewed: "Reviewed",
  cancel_requested: "Cancellation requested",
  cancelled: "Cancelled",
};

export function statusTone(status: JobStatus): "ok" | "wait" | "stop" | "plain" {
  if (["booked", "completed", "reviewed", "quoted"].includes(status)) return "ok";
  if (["held", "pending_area", "scope_review", "price_change", "awaiting_approval", "balance_due", "cancel_requested", "disputed", "in_progress"].includes(status)) return "wait";
  if (["referred", "declined", "cancelled"].includes(status)) return "stop";
  return "plain";
}
