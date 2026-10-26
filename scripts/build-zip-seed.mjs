/**
 * Builds data/zips.json and the ZIP seed migration from data/zip231.csv
 * plus the 2020 Census ZCTA gazetteer (internal points).
 *
 * Usage: node scripts/build-zip-seed.mjs [/path/to/2020_Gaz_zcta_national.txt]
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const csvPath = path.join(root, "data/zip231.csv");
const gazPath = process.argv[2] || "/tmp/gaz/2020_Gaz_zcta_national.txt";
const jsonPath = path.join(root, "data/zips.json");
const sqlPath = path.join(root, "supabase/migrations/20261026120100_seed_zips.sql");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function sqlStr(v) {
  if (v == null || v === "") return "null";
  return `'${String(v).replaceAll("'", "''")}'`;
}

const csv = parseCsv(fs.readFileSync(csvPath, "utf8"));
const header = csv[0].map((h) => h.trim());
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const dataRows = csv.slice(1).filter((r) => r.length >= 5 && /^\d{5}$/.test((r[idx.zip] || "").trim()));

const gaz = new Map();
if (fs.existsSync(gazPath)) {
  const lines = fs.readFileSync(gazPath, "utf8").split(/\r?\n/);
  const cols = lines[0].split("\t").map((c) => c.trim());
  const gZip = cols.indexOf("GEOID");
  const gLat = cols.indexOf("INTPTLAT");
  const gLng = cols.indexOf("INTPTLONG");
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const p = line.split("\t");
    const z = (p[gZip] || "").trim();
    if (!/^\d{5}$/.test(z)) continue;
    const lat = Number((p[gLat] || "").trim());
    const lng = Number((p[gLng] || "").trim());
    if (Number.isFinite(lat) && Number.isFinite(lng)) gaz.set(z, { lat, lng });
  }
} else {
  console.warn("Gazetteer not found, centroids will be empty:", gazPath);
}

const zips = dataRows.map((r) => {
  const zip = r[idx.zip].trim();
  const milesRaw = (r[idx.miles_from_cadillac] || "").trim();
  const miles = milesRaw === "" ? null : Number(milesRaw);
  const spanned = (r[idx.counties_spanned] || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const g = gaz.get(zip);
  return {
    zip,
    city: (r[idx.city] || "").trim(),
    county: (r[idx.county] || "").trim(),
    countiesSpanned: spanned,
    status: (r[idx.status] || "").trim() === "auto_book" ? "auto_book" : "owner_review",
    flagReason: (r[idx.flag_reason] || "").trim(),
    countyNote: (r[idx.county_note] || "").trim(),
    milesFromCadillac: Number.isFinite(miles) ? miles : null,
    lat: g ? Math.round(g.lat * 1e6) / 1e6 : null,
    lng: g ? Math.round(g.lng * 1e6) / 1e6 : null,
    source: (r[idx.source] || "").trim(),
  };
});

const missing = zips.filter((z) => z.lat == null).map((z) => z.zip);
if (missing.length) console.warn("No centroid for:", missing.join(", "));

fs.writeFileSync(jsonPath, JSON.stringify(zips, null, 2) + "\n");

const values = zips
  .map((z) => {
    const spanned = z.countiesSpanned.length
      ? `array[${z.countiesSpanned.map(sqlStr).join(", ")}]::text[]`
      : "'{}'::text[]";
    return `  (${sqlStr(z.zip)}, ${sqlStr(z.city)}, ${sqlStr(z.county)}, ${spanned}, '${z.status}', ${sqlStr(z.flagReason)}, ${sqlStr(z.countyNote)}, ${z.milesFromCadillac ?? "null"}, ${z.lat ?? "null"}, ${z.lng ?? "null"}, ${sqlStr(z.source)})`;
  })
  .join(",\n");

const sql = `-- Service-area lookup: 231 area-code ZIPs. Straight-line miles are from Cadillac.
-- Centroids are 2020 Census ZCTA internal points (INTPTLAT / INTPTLONG).
-- PO-box and unique ZIPs that are not ZCTAs have no centroid; travel falls back to the miles column.
insert into public.service_area_zips (
  zip, city, county, counties_spanned, status, flag_reason, county_note,
  miles_from_cadillac, lat, lng, source
) values
${values}
on conflict (zip) do update set
  city = excluded.city,
  county = excluded.county,
  counties_spanned = excluded.counties_spanned,
  status = excluded.status,
  flag_reason = excluded.flag_reason,
  county_note = excluded.county_note,
  miles_from_cadillac = excluded.miles_from_cadillac,
  lat = excluded.lat,
  lng = excluded.lng,
  source = excluded.source;
`;

fs.writeFileSync(sqlPath, sql);
const auto = zips.filter((z) => z.status === "auto_book").length;
console.log(`Wrote ${zips.length} ZIPs (${auto} auto-book, ${zips.length - auto} owner review) to ${jsonPath} and ${sqlPath}`);
