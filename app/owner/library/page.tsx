import { saveLibraryAction } from "@/lib/actions";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { libraryByGroup } from "@/lib/domain/library";
import { LIBRARY_GROUP_LABELS, type LibraryEntry, type LibraryGroup } from "@/lib/domain/library-data";

const GROUPS: LibraryGroup[] = ["handy", "trades", "build"];

const GROUP_COPY: Record<LibraryGroup, string> = {
  handy: "Handyman extras start as work we do. Turn one off to send it to you instead of instant booking.",
  trades: "Licensed trades start as refer-out. Turn one on only when you are licensed to book it directly.",
  build: "Builder work starts as refer-out. A builder-scope total of $600 or more still comes to you, even if you turn it on.",
};

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const library = await getRepository().listLibrary();
  const grouped = libraryByGroup(library);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Cost library</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          These are the research ranges for work that isn&apos;t on the rate sheet. Quotes use the high end. A ZIP in 496 takes 4% off a national figure, and a ZIP in 497 takes 5% off. Local Michigan figures are used as printed. The quote also stays at or above your hourly rate times the estimated hours times 1.25, plus materials. Travel and the area charge are added after that. This page is where you edit the ranges and the we-do-it switch.
        </p>
      </div>
      <Flash notice={query.notice} error={query.error} />
      <form action={saveLibraryAction} className="space-y-6">
        {GROUPS.map((group) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{LIBRARY_GROUP_LABELS[group]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted">{GROUP_COPY[group]}</p>
              <div className="flex flex-wrap gap-2">
                <SubmitButton name="groupAction" value={`${group}:1`} size="sm">
                  We do all of these
                </SubmitButton>
                <SubmitButton name="groupAction" value={`${group}:0`} size="sm" variant="outline">
                  Refer all of these out
                </SubmitButton>
              </div>
              <div className="space-y-4">
                {grouped[group].map((entry) => (
                  <EntryFields key={entry.id} entry={entry} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        <SubmitButton>Save library</SubmitButton>
      </form>
    </div>
  );
}

function EntryFields({ entry }: { entry: LibraryEntry }) {
  return (
    <fieldset className="grid gap-3 border-t border-line pt-4 md:grid-cols-4">
      <legend className="sr-only">{entry.name}</legend>
      <label className="grid gap-1 text-sm font-semibold md:col-span-2">
        Name
        <Input name={`name_${entry.id}`} defaultValue={entry.name} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Unit
        <Input name={`unit_${entry.id}`} defaultValue={entry.unit} />
      </label>
      <label className="flex items-end gap-2 pb-2 text-sm font-semibold">
        <input type="checkbox" name={`do_${entry.id}`} defaultChecked={entry.performs} />
        We do this
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        National low
        <Input name={`nl_${entry.id}`} inputMode="decimal" defaultValue={entry.nationalLow ?? ""} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        National high
        <Input name={`nh_${entry.id}`} inputMode="decimal" defaultValue={entry.nationalHigh ?? ""} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Local low
        <Input name={`ll_${entry.id}`} inputMode="decimal" defaultValue={entry.localLow ?? ""} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Local high
        <Input name={`lh_${entry.id}`} inputMode="decimal" defaultValue={entry.localHigh ?? ""} />
      </label>
      <label className="grid gap-1 text-sm font-semibold md:col-span-2">
        Source
        <Input name={`src_${entry.id}`} defaultValue={entry.source} />
      </label>
      <label className="grid gap-1 text-sm font-semibold md:col-span-2">
        Notes
        <Input name={`notes_${entry.id}`} defaultValue={entry.notes} />
      </label>
    </fieldset>
  );
}
