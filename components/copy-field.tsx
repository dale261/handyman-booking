"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** A US number as an sms: target, or "" when there aren't enough digits to text. */
function smsNumber(phone: string | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

/**
 * A read-only link with a copy button, for sharing the contract link by text or in person.
 * A phone can refuse the copy without saying so, which leaves the last thing copied (often
 * another job's link) on the clipboard. So the copy is tried two ways and a failure is shown,
 * and "Text it" opens the phone's messages with this job's link already typed in.
 */
export function CopyField({ value, label, phone, textBody }: { value: string; label: string; phone?: string; textBody?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const input = useRef<HTMLInputElement>(null);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // Older or stricter browsers: select the box and use the long-standing copy command.
      try {
        const box = input.current;
        if (box) {
          box.focus();
          box.select();
          box.setSelectionRange(0, value.length);
          ok = document.execCommand("copy");
        }
      } catch {
        ok = false;
      }
    }
    setState(ok ? "copied" : "failed");
    if (ok) setTimeout(() => setState("idle"), 2500);
  }

  const number = smsNumber(phone);
  const sms = number ? `sms:${number}?&body=${encodeURIComponent(`${textBody ? `${textBody} ` : ""}${value}`)}` : "";

  return (
    <div className="grid gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          readOnly
          value={value}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-2 text-xs text-ink"
        />
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {state === "copied" ? "Copied" : "Copy link"}
        </Button>
        {sms && (
          <a href={sms} className="rounded-md border border-line bg-paper px-3 py-2 text-sm font-semibold text-pine underline">
            Text it to {phone}
          </a>
        )}
      </div>
      <span aria-live="polite" className={state === "failed" ? "font-semibold text-red-700" : "text-muted"}>
        {state === "copied" && "Copied this job's link. Paste it into your text."}
        {state === "failed" && "Your phone didn't copy it, so what you paste would be the last thing you copied. Press and hold the link above and choose Copy, or use Text it."}
      </span>
    </div>
  );
}
