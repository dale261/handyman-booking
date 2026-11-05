"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type CustomerChoice = { id: string; label: string };

/**
 * Returning customers: pick one and the form reloads with their saved details filled in.
 * New customer is the default, so the form starts blank.
 */
export function CustomerPicker({ customers, selected }: { customers: CustomerChoice[]; selected: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
      Returning customer?
      <select
        name="pickCustomer"
        value={selected}
        disabled={pending}
        onChange={(event) => {
          const id = event.target.value;
          startTransition(() => router.replace(id ? `/owner/jobs/new?customer=${encodeURIComponent(id)}` : "/owner/jobs/new"));
        }}
        className="h-10 rounded-md border border-line bg-card px-3 text-sm font-normal"
      >
        <option value="">New customer (type their details below)</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.label}
          </option>
        ))}
      </select>
      <span className="font-normal text-muted">{pending ? "Loading their details…" : "Picking one fills in their saved details. Anything you change below updates their account."}</span>
    </label>
  );
}
