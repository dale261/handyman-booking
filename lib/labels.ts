import type { JobStatus } from "@/lib/db/types";

export const STATUS_LABEL: Record<JobStatus, string> = {
  quoted: "Quote ready",
  scope_review: "Owner reviewing the work",
  referred: "Referred out",
  pending_area: "Address needs a look",
  declined: "Declined",
  held: "Held for payment",
  released: "Hold released",
  booked: "Booked",
  in_progress: "Work in progress",
  awaiting_approval: "Waiting for approval",
  disputed: "Problem reported",
  balance_due: "Balance due",
  completed: "Paid and complete",
  reviewed: "Reviewed",
  cancel_requested: "Cancellation requested",
  cancelled: "Cancelled",
};

export function statusTone(status: JobStatus): "ok" | "wait" | "stop" | "plain" {
  if (["booked", "completed", "reviewed", "quoted"].includes(status)) return "ok";
  if (["held", "pending_area", "scope_review", "awaiting_approval", "balance_due", "cancel_requested", "disputed", "in_progress"].includes(status)) return "wait";
  if (["referred", "declined", "cancelled"].includes(status)) return "stop";
  return "plain";
}
