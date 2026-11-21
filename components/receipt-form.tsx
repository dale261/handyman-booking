"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addExpenseAction } from "@/lib/actions";

/** A receipt reads fine at this size, and it keeps a phone photo small enough to send. */
const MAX_SIDE = 1600;

/** Shrink a phone photo before it is sent. Phone cameras make photos far bigger than a receipt needs. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("This phone couldn't read that photo. Try taking it again."));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This phone couldn't get the photo ready. Try again.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("This phone couldn't get the photo ready. Try again."))), "image/jpeg", 0.82),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type ReceiptJob = { id: string; scope: string; where: string; when: string };

/** The line shown in the job list: the work, then the street, short enough for a phone. */
function jobLine(job: ReceiptJob): string {
  const work = job.scope.length > 44 ? `${job.scope.slice(0, 43)}…` : job.scope;
  const street = job.where.split(",")[0].trim();
  return street ? `${work} · ${street}` : work;
}

function Save({ busy }: { busy: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || busy}>
      {pending ? "Saving…" : busy ? "Photo is uploading…" : "Save receipt"}
    </Button>
  );
}

/**
 * A crew member turns in a receipt for something they paid for. The photo is optional:
 * it is shrunk on the phone, sent on its own, and only its id travels with the form.
 */
export function ReceiptForm({
  today,
  minDate,
  back,
  workers,
  jobs,
}: {
  today: string;
  minDate: string;
  back: string;
  /** Given on the owner's page, where the owner says who paid. */
  workers?: { id: string; fullName: string }[];
  /** Jobs the receipt can be tied to, with where and when, so the right one is easy to tell. */
  jobs: ReceiptJob[];
}) {
  const [jobId, setJobId] = useState("");
  const picked = jobs.find((job) => job.id === jobId);
  const [photoId, setPhotoId] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  async function onPhoto(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setProblem("");
    setPhotoId("");
    setBusy(true);
    try {
      const blob = await shrink(file);
      const body = new FormData();
      body.set("file", new File([blob], "receipt.jpg", { type: "image/jpeg" }));
      const res = await fetch("/api/photos", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error || "The photo didn't upload.");
      setPhotoId(json.id);
    } catch (error) {
      setProblem(`${error instanceof Error ? error.message : "The photo didn't upload."} You can still save the receipt without it and hand in the paper one.`);
      if (picker.current) picker.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  function clearPhoto() {
    setPhotoId("");
    setProblem("");
    if (picker.current) picker.current.value = "";
  }

  return (
    <form action={addExpenseAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="photoId" value={photoId} />
      {workers && (
        <label className="grid gap-1 font-semibold sm:col-span-2">
          Who paid
          <select name="workerId" required defaultValue="" className="h-10 rounded-md border border-line bg-card px-3 font-normal">
            <option value="" disabled>
              Pick a crew member
            </option>
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.fullName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="grid gap-1 font-semibold">
        Day you bought it
        <Input name="date" type="date" required defaultValue={today} min={minDate} max={today} />
      </label>
      <label className="grid gap-1 font-semibold">
        Amount paid
        <Input name="amount" type="number" inputMode="decimal" required min={0.01} max={5000} step={0.01} placeholder="24.50" />
      </label>
      <label className="grid gap-1 font-semibold sm:col-span-2">
        What it was
        <Input name="what" required minLength={2} maxLength={200} placeholder="Caulk and painter's tape" />
      </label>
      <label className="grid gap-1 font-semibold sm:col-span-2">
        <span>
          Job it was for <span className="font-normal text-muted">(optional)</span>
        </span>
        <select name="jobId" value={jobId} onChange={(event) => setJobId(event.target.value)} className="h-10 rounded-md border border-line bg-card px-3 font-normal">
          <option value="">Not for one job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {jobLine(job)}
            </option>
          ))}
        </select>
      </label>
      {picked && (
        <div className="rounded-md border border-line bg-paper px-3 py-2 sm:col-span-2">
          <p className="text-muted">Check it&apos;s the right job:</p>
          <p className="font-semibold">{picked.scope}</p>
          {picked.where && <p>{picked.where}</p>}
          <p>{picked.when}</p>
        </div>
      )}
      <div className="grid gap-1 sm:col-span-2">
        <span className="font-semibold">
          Photo of the receipt <span className="font-normal text-muted">(optional)</span>
        </span>
        {/* No name on purpose: the photo is sent on its own above, never with the form. */}
        <Input ref={picker} type="file" accept="image/*" onChange={(event) => onPhoto(event.target.files)} disabled={busy} />
        {busy && <p className="text-muted">Uploading the photo…</p>}
        {photoId && !busy && (
          <p className="text-pine">
            Photo attached.{" "}
            <button type="button" className="font-semibold underline" onClick={clearPhoto}>
              Remove it
            </button>
          </p>
        )}
        {problem && (
          <p role="status" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
            {problem}
          </p>
        )}
      </div>
      <div className="sm:col-span-2">
        <Save busy={busy} />
      </div>
    </form>
  );
}
