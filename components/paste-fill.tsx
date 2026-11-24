"use client";

import { useRef, useState, useTransition } from "react";
import { readPasteAction } from "@/lib/actions";
import { filledLabels, fillFromRules, stillNeeded, type PasteFill, type PasteRead } from "@/lib/domain/paste-fill";

/**
 * Paste a customer's message, or type the job in your own words, and the Add-a-job form
 * below fills itself in. With an AI key set the AI reads it; what it isn't sure about goes
 * to the bottom of Details. Without one, the built-in reader finds the contact details.
 * Nothing is saved until the owner taps Add the job.
 */
export function PasteFill() {
  const box = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function apply(form: HTMLFormElement, read: PasteRead) {
    const fill = read.fill;
    const put = (name: string, value: string) => {
      const field = form.elements.namedItem(name);
      if (!value || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
      field.value = value;
    };
    put("fullName", fill.fullName);
    put("phone", fill.phone);
    put("email", fill.email);
    put("billingAddress", fill.billingAddress);
    put("billingZip", fill.billingZip);
    put("jobSiteAddress", fill.jobSiteAddress);
    put("service", fill.service);
    put("scope", fill.scope);
    put("description", fill.details);
    put("total", fill.total);
    put("travel", fill.travel);
    put("hours", fill.hours);
    put("days", fill.days);
    put("crewSize", fill.crewSize);
    put("done", fill.done);
    put("doneOn", fill.doneOn);
    const whiteLabel = form.elements.namedItem("whiteLabel");
    if (fill.whiteLabel && whiteLabel instanceof HTMLInputElement) whiteLabel.checked = true;
    setNote(summary(read, fill));
  }

  function fill() {
    const area = box.current;
    const form = area?.closest("form");
    if (!area || !form) return;
    const text = area.value;
    if (!text.trim()) {
      setNote({ ok: false, text: "Paste their message or type the job in the box first." });
      return;
    }
    setNote(null);
    start(async () => {
      let read: PasteRead;
      try {
        read = await readPasteAction(text);
      } catch {
        // No signal, or the site didn't answer: the built-in reader runs on the phone.
        read = { source: "rules", fill: fillFromRules(text), why: "failed" };
      }
      apply(form, read);
    });
  }

  return (
    <div className="grid gap-2 rounded-md border border-line bg-card p-4 text-sm">
      <label className="grid gap-1 font-semibold">
        Paste their message, or type the job in your own words
        <textarea
          ref={box}
          rows={4}
          className="rounded-md border border-line bg-card px-3 py-2 text-sm font-normal"
          placeholder="Who it's for, their phone, where, what the work is, and your price if you have one. The form below gets filled in."
        />
      </label>
      <div>
        <button type="button" onClick={fill} disabled={pending} className="h-10 rounded-md border border-pine px-4 text-sm font-semibold text-pine disabled:opacity-60">
          {pending ? "Reading…" : "Fill in the form"}
        </button>
      </div>
      {note && <p className={note.ok ? "text-pine" : "text-red-700"}>{note.text}</p>}
    </div>
  );
}

/** The line under the button: what was filled in, what to look at, and what is still missing. Kept short for a phone. */
function summary(read: PasteRead, fill: PasteFill): { ok: boolean; text: string } {
  const filled = filledLabels(fill);
  if (filled.length === 0) return { ok: false, text: `Couldn't find anything to fill in from that. Type it below.${whyNot(read)}` };
  if (read.source === "rules") {
    // The built-in reader only looks for contact details; the title and price are always the owner's to add.
    const missing = [!fill.fullName && "name", !fill.phone && "phone"].filter(Boolean);
    const parts = [`Filled in: ${filled.join(", ")}.`];
    if (missing.length) parts.push(`Couldn't find the ${missing.join(" or ")}; type it below.`);
    parts.push(`Check them, then add the title and your price.${whyNot(read)}`);
    return { ok: missing.length === 0, text: parts.join(" ") };
  }
  const needed = stillNeeded(fill);
  const parts = [`Filled in ${filled.length} ${filled.length === 1 ? "box" : "boxes"} below.`];
  if (fill.unsure > 0) {
    parts.push(
      `Not sure about ${fill.unsure === 1 ? "1 thing: it's" : `${fill.unsure} things: they're`} at the bottom of Details. Fix or delete ${fill.unsure === 1 ? "it" : "them"} before you add the job, because Details prints on the agreement.`,
    );
  }
  if (needed.length > 0) parts.push(`Still needed: ${needed.join(", ")}.`);
  if (fill.unsure === 0) parts.push("Check it over before you add the job.");
  return { ok: fill.unsure === 0 && needed.length === 0, text: parts.join(" ") };
}

/** Why the AI didn't read it, when it didn't. */
function whyNot(read: PasteRead): string {
  if (read.source === "ai") return "";
  if (read.why === "no-key") return " The AI reader isn't connected, so only contact details are read.";
  if (read.why === "busy") return " The AI reader has been used a lot this hour, so only contact details were read.";
  return " The AI reader didn't answer, so only contact details were read. Tap the button to try again.";
}
