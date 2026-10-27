import type { EmailRecord } from "@/lib/db/types";
import type { Repository } from "@/lib/db/repository";

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function flushEmails(repo: Repository): Promise<void> {
  if (!resendConfigured()) return;
  const emails = await repo.listEmails();
  const pending = emails.filter((email) => !email.sent).slice(0, 20);
  for (const email of pending) {
    const ok = await sendResend(email);
    if (ok) await repo.markEmailSent(email.id);
  }
}

async function sendResend(email: EmailRecord): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "eX Construction <onboarding@resend.dev>",
        to: [email.to],
        subject: email.subject,
        text: email.body,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[email] Resend returned", res.status, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] Resend request failed", error);
    return false;
  }
}
