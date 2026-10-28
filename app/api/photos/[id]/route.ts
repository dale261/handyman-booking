import { NextResponse } from "next/server";
import { currentActor } from "@/lib/auth";
import { readPhoto } from "@/lib/photos";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return new NextResponse("Sign in to view photos.", { status: 401 });
  const { id } = await context.params;
  const photo = await readPhoto(id);
  if (!photo) return new NextResponse("Photo not found.", { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=3600" },
  });
}
