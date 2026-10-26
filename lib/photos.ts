import "server-only";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { supabaseConfigured } from "@/lib/db/index";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5_000_000;

function dir(): string {
  const root = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function savePhoto(id: string, name: string, type: string, bytes: Buffer): Promise<void> {
  if (!TYPES.has(type)) throw new Error("Use a JPEG, PNG, WEBP, or GIF photo.");
  if (bytes.length > MAX_BYTES) throw new Error("Each photo must be 5 MB or smaller.");
  if (supabaseConfigured()) {
    const { error } = await service().storage.from("job-photos").upload(id, bytes, { contentType: type, upsert: false });
    if (error) throw new Error(error.message);
    return;
  }
  fs.writeFileSync(path.join(dir(), id), bytes);
  fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify({ name, type }));
}

export async function readPhoto(id: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (supabaseConfigured()) {
    const { data, error } = await service().storage.from("job-photos").download(id);
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    return { bytes, type: data.type || "image/jpeg" };
  }
  const file = path.join(dir(), id);
  const meta = path.join(dir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const type = fs.existsSync(meta) ? (JSON.parse(fs.readFileSync(meta, "utf8")) as { type?: string }).type || "image/jpeg" : "image/jpeg";
  return { bytes: fs.readFileSync(file), type };
}
