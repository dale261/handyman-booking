import type { AreaCheck, ZipRecord } from "./types";

export function extractZip(text: string): string {
  const m = text.match(/\b\d{5}\b/g);
  return m && m.length > 0 ? m[m.length - 1] : "";
}

export function areaCheck(textOrZip: string, table: ZipRecord[]): AreaCheck {
  const zip = /^\d{5}$/.test(textOrZip.trim()) ? textOrZip.trim() : extractZip(textOrZip);
  if (!zip) {
    return {
      found: false,
      zip: "",
      auto: false,
      inTable: false,
      label: "Type a 5-digit ZIP",
      detail: "The ZIP is looked up in the app's own 231 table, with no outside service.",
      milesFromCadillac: null,
      county: "",
      city: "",
      lat: null,
      lng: null,
    };
  }
  const z = table.find((row) => row.zip === zip);
  if (!z) {
    return {
      found: true,
      zip,
      auto: false,
      inTable: false,
      label: "Not in the 231 table: owner approval",
      detail: "Outside the working area, so the request goes to the owner.",
      milesFromCadillac: null,
      county: "",
      city: "",
      lat: null,
      lng: null,
    };
  }
  const note = z.flagReason || z.countyNote;
  if (z.status !== "auto_book") {
    return {
      found: true,
      zip,
      auto: false,
      inTable: true,
      label: "Owner review",
      detail: `${z.city}, ${z.county} County${note ? `. ${note}` : ""}.`,
      milesFromCadillac: z.milesFromCadillac,
      county: z.county,
      city: z.city,
      lat: z.lat,
      lng: z.lng,
    };
  }
  return {
    found: true,
    zip,
    auto: true,
    inTable: true,
    label: "Inside 231: auto-book",
    detail: `${z.city}, ${z.county} County${note ? `. ${note}` : ""}. No distance limit.`,
    milesFromCadillac: z.milesFromCadillac,
    county: z.county,
    city: z.city,
    lat: z.lat,
    lng: z.lng,
  };
}
