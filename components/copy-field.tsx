"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** A read-only link with a copy button, for sharing the contract link by text or in person. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="grid gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={value}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-2 text-xs text-ink"
        />
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
