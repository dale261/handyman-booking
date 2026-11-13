import type { ServiceId } from "@/lib/domain/types";

/** What we could read out of a pasted message (a website form email, a text, a note). Blank = not found. */
export type PastedContact = {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  zip: string;
  details: string;
  service: ServiceId | "";
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/;
const ZIP = /\b\d{5}(?:-\d{4})?\b/;
const STREET = /^\d+[A-Z]?\s+[A-Z0-9.' ]+\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|hwy|highway|trl|trail|pl|place|cir|circle|pkwy|ter|terrace|m-\d+|us-\d+)\b/i;

const LABELS: { field: "name" | "first" | "last" | "phone" | "email" | "address" | "city" | "state" | "zip" | "details" | "service"; match: RegExp }[] = [
  { field: "first", match: /^first(\s*name)?$/ },
  { field: "last", match: /^(last|sur)\s*name$|^last$/ },
  { field: "name", match: /^(full\s*|your\s*|customer\s*)?name$|^customer$|^from$/ },
  { field: "phone", match: /phone|mobile|cell|^tel|number$/ },
  { field: "email", match: /e-?mail/ },
  { field: "address", match: /address|street|location|job\s*site|^where$/ },
  { field: "city", match: /^(city|town)$/ },
  { field: "state", match: /^state$/ },
  { field: "zip", match: /zip|postal/ },
  { field: "service", match: /service|type of (work|job|project)|^(job|project) type$/ },
  { field: "details", match: /message|details|description|comment|notes?$|project|request|how can we help|what do you need|tell us|^job$|^work$/ },
];

const SERVICE_WORDS: [ServiceId, RegExp][] = [
  ["tv", /\btv\b|television/i],
  ["blinds", /blind|curtain|drape|shade/i],
  ["furniture", /furniture|assembl|ikea/i],
  ["paint", /paint/i],
  ["yard", /yard|leaves|leaf|rak(e|ing)|brush|lawn/i],
  ["clean", /clean/i],
  ["helper", /helper|moving|lifting|\bmove\b/i],
];

/** Which listed service the words point at; "" when nothing matches (the form keeps "Something else"). */
export function guessService(text: string): ServiceId | "" {
  for (const [id, words] of SERVICE_WORDS) if (words.test(text)) return id;
  return "";
}

function tidyPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : raw.trim();
}

function looksLikeName(line: string): boolean {
  if (/[\d@:/]/.test(line)) return false;
  const words = line.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-Z][A-Za-z.'-]*$/.test(word));
}

/**
 * Read a customer's details out of whatever the owner pastes: a "Name: … / Phone: …" form
 * email, or a plain message. Labeled lines win; otherwise the phone, email, ZIP and a street
 * line are found by shape. Everything left over becomes the job details. Never guesses a price.
 */
export function parsePastedContact(text: string): PastedContact {
  const out: PastedContact = { fullName: "", phone: "", email: "", address: "", zip: "", details: "", service: "" };
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^[\s>*•-]+/, "").trim())
    .filter(Boolean);
  let first = "";
  let last = "";
  let city = "";
  let state = "";
  let serviceText = "";
  const details: string[] = [];
  const loose: string[] = [];
  let detailsOpen = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const labeled = /^([A-Za-z][A-Za-z '/?-]{0,40}?)\s*[:=]\s*(.*)$/.exec(line);
    const label = labeled ? LABELS.find((entry) => entry.match.test(labeled[1].trim().toLowerCase())) : undefined;
    if (!labeled || !label) {
      // A line under an open "Message:" label belongs to the message.
      (detailsOpen ? details : loose).push(line);
      continue;
    }
    detailsOpen = false;
    let value = labeled[2].trim();
    // Some form emails put the answer on the line under the label.
    if (!value && lines[i + 1] && !/^[A-Za-z][A-Za-z '/?-]{0,40}?\s*[:=]/.test(lines[i + 1])) {
      value = lines[i + 1];
      i += 1;
    }
    if (label.field === "name") out.fullName ||= value;
    else if (label.field === "first") first ||= value;
    else if (label.field === "last") last ||= value;
    else if (label.field === "phone") out.phone ||= tidyPhone(value);
    else if (label.field === "email") out.email ||= EMAIL.exec(value)?.[0] ?? "";
    else if (label.field === "address") out.address ||= value;
    else if (label.field === "city") city ||= value;
    else if (label.field === "state") state ||= value;
    else if (label.field === "zip") out.zip ||= ZIP.exec(value)?.[0].slice(0, 5) ?? "";
    else if (label.field === "service") serviceText ||= value;
    else {
      if (value) details.push(value);
      detailsOpen = true;
    }
  }

  if (!out.fullName && (first || last)) out.fullName = `${first} ${last}`.trim();

  // Whatever wasn't labeled: find things by their shape.
  const rest: string[] = [];
  for (const original of loose) {
    let line = original;
    const email = EMAIL.exec(line);
    if (email) {
      out.email ||= email[0];
      line = line.replace(email[0], " ");
    }
    const phone = PHONE.exec(line);
    if (phone) {
      out.phone ||= tidyPhone(phone[0]);
      line = line.replace(phone[0], " ");
    }
    line = line.replace(/\s{2,}/g, " ").replace(/^[\s,;|-]+|[\s,;|-]+$/g, "");
    if (!line) continue;
    if (!out.address && STREET.test(line)) {
      out.address = line;
      continue;
    }
    if (!out.fullName && looksLikeName(line)) {
      out.fullName = line;
      continue;
    }
    rest.push(line);
  }

  if (out.address && (city || state)) {
    const lower = out.address.toLowerCase();
    if (city && !lower.includes(city.toLowerCase())) out.address += `, ${city}`;
    if (state && !new RegExp(`\\b${state}\\b`, "i").test(out.address)) out.address += `, ${state}`;
  } else if (!out.address && city) {
    out.address = [city, state].filter(Boolean).join(", ");
  }
  if (!out.zip) out.zip = ZIP.exec(out.address)?.[0].slice(0, 5) ?? "";
  if (!out.zip) {
    const found = rest.map((line) => /^\d{5}$/.exec(line)?.[0]).find(Boolean);
    if (found) {
      out.zip = found;
      rest.splice(rest.indexOf(found), 1);
    }
  }

  out.details = [...details, ...rest].join("\n").trim();
  out.service = guessService(`${serviceText} ${out.details}`);
  if (serviceText && !out.service) out.details = out.details ? `${serviceText}\n${out.details}` : serviceText;
  return out;
}
