import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentActor } from "@/lib/auth";
import { savePhoto } from "@/lib/photos";

export async function POST(request: Request) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in before uploading a photo." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a photo." }, { status: 400 });
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const id = randomUUID();
    await savePhoto(id, file.name || "photo", file.type, bytes);
    return NextResponse.json({ id, name: file.name || "photo" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
