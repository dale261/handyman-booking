"use client";

import { useRef, useState } from "react";
import { parsePastedContact } from "@/lib/domain/paste-contact";

/**
 * Paste a customer's message (the website form email, a text) and the Add-a-job form
 * below fills itself in. Nothing is saved until the owner taps Add the job.
 */
export function PasteFill() {
  const box = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function fill() {
    const area = box.current;
    const form = area?.closest("form");
    if (!area || !form) return;
    if (!area.value.trim()) {
      setNote({ ok: false, text: "Paste their message in the box first." });
      return;
    }
    const got = parsePastedContact(area.value);
    const filled: string[] = [];
    const put = (name: string, value: string, label: string) => {
      const field = form.elements.namedItem(name);
      if (!value || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
      field.value = value;
      filled.push(label);
    };
    put("fullName", got.fullName, "name");
    put("phone", got.phone, "phone");
    put("email", got.email, "email");
    put("billingAddress", got.address, "address");
    put("billingZip", got.zip, "ZIP");
    put("service", got.service, "service");
    put("description", got.details, "details");
    const missing = [!got.fullName && "name", !got.phone && "phone"].filter(Boolean);
    setNote(
      filled.length === 0
        ? { ok: false, text: "Couldn't find a name, phone, or address in that. Type them below." }
        : {
            ok: missing.length === 0,
            text: `Filled in: ${filled.join(", ")}.${missing.length ? ` Couldn't find the ${missing.join(" or ")}; type it below.` : ""} Check them, then add the title and your price.`,
          },
    );
  }

  return (
    <div className="grid gap-2 rounded-md border border-line bg-card p-4 text-sm">
      <label className="grid gap-1 font-semibold">
        Have their message? Paste it here
        <textarea
          ref={box}
          rows={4}
          className="rounded-md border border-line bg-card px-3 py-2 text-sm font-normal"
          placeholder="Paste the website request email or their text. Name, phone, email, address, and what they want get filled in below."
        />
      </label>
      <div>
        <button type="button" onClick={fill} className="h-10 rounded-md border border-pine px-4 text-sm font-semibold text-pine">
          Fill in the form
        </button>
      </div>
      {note && <p className={note.ok ? "text-pine" : "text-red-700"}>{note.text}</p>}
    </div>
  );
}
