"use client";

import { useState, useTransition } from "react";
import { submitQuote } from "@/lib/actions";
import { LOCKED_PRICE } from "@/lib/domain/copy";
import { quoteToolServices } from "@/lib/domain/direct-booking";
import { DEFAULT_PARAMS, SERVICE_LABELS, type QuoteParams, type ServiceId } from "@/lib/domain/types";
import { Field, ServiceFields } from "@/components/service-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type WorkerOption = { id: string; fullName: string };

const SERVICES: ServiceId[] = quoteToolServices();

const PLACEHOLDERS: Record<ServiceId, string> = {
  paint: "For example: repaint the living room walls, one color",
  tv: "For example: mount a 55-inch TV on a drywall wall",
  blinds: "For example: hang blinds on three bedroom windows",
  furniture: "For example: assemble a desk and a bookcase",
  yard: "For example: spring cleanup of the front and back yard",
  clean: "For example: routine clean of the kitchen and two bathrooms",
  helper: "For example: two helpers to move boxes into the garage",
  other: "For example: install 40 feet of baseboard in the hallway",
};

const SAMPLES: { label: string; service: ServiceId; description: string; params: Partial<QuoteParams> }[] = [
  {
    label: "Large interior paint job",
    service: "paint",
    description: "Repaint the living room, dining room, hallway and two bedrooms: walls and trim, three colors",
    params: { rooms: 5, sqft: 1400, height: "9", cond: "fair", doors: 10, colors: 3 },
  },
  {
    label: "Pre-1978 house repaint",
    service: "paint",
    description: "Repaint two bedrooms in our 1955 farmhouse, some peeling paint on the trim",
    params: { rooms: 2, sqft: 300, height: "8", cond: "fair", doors: 3, colors: 2, pre1978: true },
  },
  {
    label: "Mount a 65-inch TV",
    service: "tv",
    description: "Mount a 65-inch TV on a drywall living-room wall and hide the cords",
    params: { tvSize: "75", wall: "drywall", conceal: "lowvolt" },
  },
  {
    label: "Hire 2 helpers for 4 hours",
    service: "helper",
    description: "Two helpers to move furniture and boxes into the garage",
    params: { helpers: 2, hours: 4 },
  },
  {
    label: "Hire 1 helper for 1 hour",
    service: "helper",
    description: "One helper to carry a couch upstairs",
    params: { helpers: 1, hours: 1 },
  },
  {
    label: "Bathroom faucet",
    service: "other",
    description: "Replace the bathroom sink faucet with one I already bought",
    params: { hours: 1.5, materials: 0 },
  },
];

export function BookForm({
  billingAddress,
  workers,
  helperMax,
  helperMaxHours,
}: {
  billingAddress: string;
  workers: WorkerOption[];
  helperMax: number;
  helperMaxHours: number;
}) {
  const [service, setService] = useState<ServiceId>("tv");
  const [params, setParams] = useState<QuoteParams>(DEFAULT_PARAMS);
  const [description, setDescription] = useState("");
  const [differentSite, setDifferentSite] = useState(false);
  const [jobSiteAddress, setJobSiteAddress] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [pickup, setPickup] = useState(false);
  const [preferredWorkerId, setPreferredWorkerId] = useState("");
  const [photos, setPhotos] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function patch(partial: Partial<QuoteParams>) {
    setParams((current) => ({ ...current, ...partial }));
  }

  function chooseService(id: ServiceId) {
    if (id === service) return;
    setService(id);
    setDescription("");
    setError("");
  }

  function loadSample(sample: (typeof SAMPLES)[number]) {
    setService(sample.service);
    setDescription(sample.description);
    setParams({ ...DEFAULT_PARAMS, ...sample.params });
    setError("");
  }

  async function onPhotos(list: FileList | null) {
    if (!list) return;
    const next = [...photos];
    for (const file of Array.from(list)) {
      if (next.length >= 6) break;
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/photos", { method: "POST", body });
      const json = (await res.json()) as { id?: string; name?: string; error?: string };
      if (!res.ok || !json.id || !json.name) {
        setError(json.error || "Photo upload failed.");
        break;
      }
      next.push({ id: json.id, name: json.name });
    }
    setPhotos(next);
  }

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        start(async () => {
          const result = await submitQuote({
            service,
            description,
            params,
            differentSite,
            jobSiteAddress,
            urgent: service === "helper" ? false : urgent,
            pickup: service === "helper" ? false : pickup,
            preferredWorkerId: preferredWorkerId || null,
            photos,
          });
          if (result?.error) setError(result.error);
        });
      }}
    >
      <fieldset className="grid gap-3">
        <legend className="font-display text-xl font-semibold">What do you need done?</legend>
        <div className="flex flex-wrap gap-2">
          {SERVICES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => chooseService(id)}
              className={
                service === id
                  ? "rounded-full bg-pine px-3 py-1.5 text-sm font-semibold text-white"
                  : "rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold"
              }
            >
              {SERVICE_LABELS[id]}
            </button>
          ))}
        </div>
      </fieldset>

      <ServiceFields service={service} params={params} patch={patch} helperMax={helperMax} helperMaxHours={helperMaxHours} />

      <Field label="Describe the job">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={PLACEHOLDERS[service]}
          required
          minLength={8}
        />
      </Field>
      <p className="text-sm text-muted">
        {service === "other"
          ? LOCKED_PRICE
          : "We'll price this from the work you describe. A note from your description doesn't change the price."}
      </p>

      <div className="flex flex-wrap gap-2">
        {SAMPLES.map((sample) => (
          <Button key={sample.label} type="button" variant="outline" size="sm" onClick={() => loadSample(sample)}>
            {sample.label}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border border-line bg-card p-4 text-sm">
        <p className="font-semibold">Job site</p>
        <p className="mt-1 text-muted">{billingAddress}</p>
        <div className="mt-3 flex items-center gap-3">
          <Switch checked={differentSite} onCheckedChange={setDifferentSite} id="different-site" />
          <Label htmlFor="different-site">The work is at a different address</Label>
        </div>
        {differentSite && (
          <div className="mt-3">
            <Field label="Job site address, including ZIP">
              <Input value={jobSiteAddress} onChange={(e) => setJobSiteAddress(e.target.value)} placeholder="12 Lake St, Glen Arbor, MI 49636" />
            </Field>
          </div>
        )}
      </div>

      {service !== "helper" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3">
            <Switch checked={urgent} onCheckedChange={setUrgent} id="urgent" />
            <Label htmlFor="urgent">Need it soon</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={pickup} onCheckedChange={setPickup} id="pickup" />
            <Label htmlFor="pickup">Pick up materials for me</Label>
          </div>
        </div>
      )}

      <Field label="Preferred crew member (optional)">
        <select
          className="flex h-10 w-full rounded-md border border-line bg-card px-3 text-sm"
          value={preferredWorkerId}
          onChange={(e) => setPreferredWorkerId(e.target.value)}
        >
          <option value="">No preference</option>
          {workers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.fullName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Photos (up to 6)">
        <Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(e) => onPhotos(e.target.files)} />
      </Field>
      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm">
          {photos.map((photo) => (
            <li key={photo.id} className="rounded-md border border-line bg-card px-2 py-1">
              {photo.name}
              <button type="button" className="ml-2 text-copper" onClick={() => setPhotos(photos.filter((item) => item.id !== photo.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Working on your quote…" : "Get my quote"}
      </Button>
    </form>
  );
}
