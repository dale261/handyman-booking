import Link from "next/link";
import { openResetLinkAction } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Where the emailed reset link lands. The one-time token is only spent when the
 * person taps the button, so a mail app or scanner that opens the link first
 * doesn't use it up, and it works in whatever browser the email opens.
 */
export default async function OpenResetLinkPage({ searchParams }: { searchParams: Promise<{ token_hash?: string }> }) {
  const query = await searchParams;
  const tokenHash = query.token_hash ?? "";
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          {tokenHash ? (
            <form action={openResetLinkAction} className="grid gap-4">
              <input type="hidden" name="tokenHash" value={tokenHash} />
              <p className="text-sm text-muted">Tap the button to choose a new password.</p>
              <SubmitButton pendingLabel="One moment…">Set a new password</SubmitButton>
            </form>
          ) : (
            <div className="space-y-3 text-sm">
              <p>This link is missing its code. Ask for a new one.</p>
              <Link className="font-semibold text-pine underline" href="/forgot">
                Send me a new link
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
