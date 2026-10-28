import { discardDraftAction } from "@/lib/actions";
import { getRepository } from "@/lib/db/index";
import { readDraftCookie } from "@/lib/draft-cookie";
import { SERVICE_LABELS } from "@/lib/domain/types";
import { usd } from "@/lib/format";
import { publicEstimate } from "@/lib/services/estimate";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * On the sign-up and sign-in pages: the price the visitor just saw, so they
 * know the account is the last step before picking a time.
 */
export async function DraftBanner({ action }: { action: "signup" | "login" }) {
  const draft = await readDraftCookie();
  if (!draft) return null;
  const result = await publicEstimate(getRepository(), draft);
  const verb = action === "signup" ? "Create your account" : "Sign in";
  const label = SERVICE_LABELS[draft.service];
  let headline: string;
  if (!result.ok) {
    headline = `${verb} to finish your quote (${label}).`;
  } else if (result.data.review) {
    headline = `${verb} and Dale will send you one firm price (${label}).`;
  } else {
    headline = `Your price is ${usd(result.data.total)} (${label}). ${verb} to pick a time.`;
  }
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="font-semibold">{headline}</p>
        <form action={discardDraftAction}>
          <SubmitButton size="sm" variant="ghost">Start over</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
