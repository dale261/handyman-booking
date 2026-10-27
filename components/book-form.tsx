"use client";

import { useState, useTransition } from "react";
import { submitQuote } from "@/lib/actions";
import { DEFAULT_PARAMS, SERVICE_LABELS, type QuoteParams, type ServiceId } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type WorkerOption = { id: string; fullName: string };

const SERVICES: ServiceId[] = ["paint", "tv", "blinds", "furniture", "yard", "clean", "helper", "other"];

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

      <div className="grid gap-4 sm:grid-cols-2">
        {service === "paint" && (
          <>
            <Field label="Rooms">
              <Input type="number" min={1} value={params.rooms} onChange={(e) => patch({ rooms: Number(e.target.value) })} />
            </Field>
            <Field label="Floor area (sq ft)">
              <Input type="number" min={1} value={params.sqft} onChange={(e) => patch({ sqft: Number(e.target.value) })} />
            </Field>
            <Field label="Ceiling height">
              <Select value={params.height} onChange={(value) => patch({ height: value as QuoteParams["height"] })} options={[["8", "8 ft"], ["9", "9–10 ft"], ["11", "11 ft or vaulted"]]} />
            </Field>
            <Field label="Wall condition">
              <Select value={params.cond} onChange={(value) => patch({ cond: value as QuoteParams["cond"] })} options={[["good", "Good"], ["fair", "Fair"], ["poor", "Poor"]]} />
            </Field>
            <Field label="Doors and trim pieces">
              <Input type="number" min={0} value={params.doors} onChange={(e) => patch({ doors: Number(e.target.value) })} />
            </Field>
            <Field label="Colors">
              <Input type="number" min={1} value={params.colors} onChange={(e) => patch({ colors: Number(e.target.value) })} />
            </Field>
            <Toggle label="Include ceilings" checked={params.ceilings} onChange={(ceilings) => patch({ ceilings })} />
            <Toggle label="Home built before 1978" checked={params.pre1978} onChange={(pre1978) => patch({ pre1978 })} />
          </>
        )}
        {service === "tv" && (
          <>
            <Field label="TV size">
              <Select value={params.tvSize} onChange={(value) => patch({ tvSize: value as QuoteParams["tvSize"] })} options={[["55", "Up to 55 in"], ["75", "56–75 in"], ["85", "76 in or larger"]]} />
            </Field>
            <Field label="Wall">
              <Select value={params.wall} onChange={(value) => patch({ wall: value as QuoteParams["wall"] })} options={[["drywall", "Drywall"], ["plaster", "Plaster"], ["brick", "Brick or stone"]]} />
            </Field>
            <Field label="Cords">
              <Select
                value={params.conceal}
                onChange={(value) => patch({ conceal: value as QuoteParams["conceal"] })}
                options={[
                  ["none", "Leave them visible"],
                  ["raceway", "Cord cover"],
                  ["lowvolt", "Hide low-voltage wires in the wall"],
                  ["power", "New electrical outlet"],
                ]}
              />
            </Field>
          </>
        )}
        {service === "blinds" && (
          <>
            <Field label="Windows">
              <Input type="number" min={1} value={params.windows} onChange={(e) => patch({ windows: Number(e.target.value) })} />
            </Field>
            <Field label="What is going up">
              <Select value={params.blindKind} onChange={(value) => patch({ blindKind: value as QuoteParams["blindKind"] })} options={[["blinds", "Blinds"], ["curtains", "Curtains"]]} />
            </Field>
          </>
        )}
        {service === "furniture" && (
          <>
            <Field label="Number of items">
              <Input type="number" min={1} value={params.items} onChange={(e) => patch({ items: Number(e.target.value) })} />
            </Field>
            <Field label="Item size">
              <Select value={params.itemKind} onChange={(value) => patch({ itemKind: value as QuoteParams["itemKind"] })} options={[["small", "Small (chair, nightstand)"], ["medium", "Medium (desk, dresser, bed)"], ["large", "Large (wardrobe, sectional)"]]} />
            </Field>
          </>
        )}
        {(service === "yard" || service === "clean") && (
          <Field label="Estimated hours">
            <Input type="number" min={0.5} step={0.5} value={params.hours} onChange={(e) => patch({ hours: Number(e.target.value) })} />
          </Field>
        )}
        {service === "yard" && <Toggle label="Haul away yard waste" checked={params.haul} onChange={(haul) => patch({ haul })} />}
        {service === "clean" && <Toggle label="Deep clean" checked={params.deep} onChange={(deep) => patch({ deep })} />}
        {service === "other" && (
          <p className="text-sm text-muted sm:col-span-2">
            Tell us the work and the quantity, like 40 feet of baseboard. If we need more detail, or the job needs a license, Dale will review it before you can book.
          </p>
        )}
        {service === "helper" && (
          <>
            <Field label="Helpers">
              <Select value={String(params.helpers)} onChange={(value) => patch({ helpers: Number(value) })} options={Array.from({ length: helperMax }, (_, i) => [String(i + 1), String(i + 1)])} />
            </Field>
            <Field label="Hours (1 hour minimum)">
              <Select value={String(params.hours)} onChange={(value) => patch({ hours: Number(value) })} options={Array.from({ length: helperMaxHours }, (_, i) => [String(i + 1), String(i + 1)])} />
            </Field>
          </>
        )}
      </div>

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
          ? "This is an estimate based on your description and local pricing. If the job turns out different on site, we'll talk with you before changing anything."
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      {children}
    </label>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <select className="flex h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="flex items-center gap-3 sm:col-span-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
