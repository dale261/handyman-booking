import { NextResponse } from "next/server";
import { getRepository } from "@/lib/db/index";

/**
 * Keep-alive and health check. Vercel's daily cron calls this so the free
 * Supabase project sees activity and does not pause after a quiet week.
 * It reads one settings row and reports nothing else.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    await getRepository().getSettings();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[health] database check failed", error);
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
