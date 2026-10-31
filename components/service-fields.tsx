"use client";

import type { QuoteParams, ServiceId } from "@/lib/domain/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * The questions each listed service asks. Shared by the signed-in quote form
 * and the public price page so both ask exactly the same things.
 */
export function ServiceFields({
  service,
  params,
  patch,
  helperMax,
  helperMaxHours,
}: {
  service: ServiceId;
  params: QuoteParams;
  patch: (partial: Partial<QuoteParams>) => void;
  helperMax: number;
  helperMaxHours: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {service === "paint" && (
        <>
          <Field label="Rooms">
            <Input type="number" min={1} value={params.rooms} onChange={(e) => patch({ rooms: Number(e.target.value) })} />
          </Field>
          <Field label="Wall lengths (feet)" hint="Each wall you want painted, in feet, separated by commas. A 12 by 14 room is 12, 14, 12, 14.">
            <Input type="text" inputMode="decimal" placeholder="12, 14, 12, 14" value={params.walls} onChange={(e) => patch({ walls: e.target.value })} />
          </Field>
          <Field label="Ceiling height">
            <Select value={params.height} onChange={(value) => patch({ height: value as QuoteParams["height"] })} options={[["8", "8 ft"], ["9", "9–10 ft"], ["11", "11 ft or vaulted"]]} />
          </Field>
          <Field label="Wall condition">
            <Select value={params.cond} onChange={(value) => patch({ cond: value as QuoteParams["cond"] })} options={[["good", "Good"], ["fair", "Fair"], ["poor", "Poor"]]} />
          </Field>
          <Field label="Doors and windows (openings)" hint="Count every door and window in those walls. We trim and cut in around each one.">
            <Input type="number" min={0} value={params.doors} onChange={(e) => patch({ doors: Number(e.target.value) })} />
          </Field>
          <Field label="Colors">
            <Input type="number" min={1} value={params.colors} onChange={(e) => patch({ colors: Number(e.target.value) })} />
          </Field>
          <Toggle label="Include ceilings" checked={params.ceilings} onChange={(ceilings) => patch({ ceilings })} />
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
          Tell us the work and the quantity, like 40 feet of baseboard. If we need more detail, or the job needs a license, we&apos;ll review it before you can book.
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
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[][] }) {
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

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="flex items-center gap-3 sm:col-span-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
