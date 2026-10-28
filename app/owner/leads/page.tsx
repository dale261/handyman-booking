import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { SERVICE_LABELS } from "@/lib/domain/types";
import { usd } from "@/lib/format";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Detroit", dateStyle: "medium", timeStyle: "short" });
}

export default async function LeadsPage() {
  await requireRole("owner");
  const leads = await getRepository().listLeads();
  const open = leads.filter((lead) => !lead.jobId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Leads</h1>
        <p className="mt-1 text-sm text-muted">
          Everyone who gave a name and phone to see a price. {open.length} {open.length === 1 ? "hasn't" : "haven't"} booked yet. Newest first.
        </p>
      </div>
      {leads.length === 0 ? (
        <p className="text-sm text-muted">No leads yet. They show up here as soon as someone checks a price on the public page.</p>
      ) : (
        <div className="grid gap-3">
          {leads.map((lead) => (
            <Card key={lead.id}>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{lead.fullName}</p>
                    <p>
                      <a className="font-semibold text-pine underline" href={`tel:${lead.phone}`}>{lead.phone}</a>
                      {lead.email ? (
                        <>
                          {" · "}
                          <a className="font-semibold text-pine underline" href={`mailto:${lead.email}`}>{lead.email}</a>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {lead.jobId ? (
                    <Link href={`/jobs/${lead.jobId}`}>
                      <Badge tone="ok">Booked · open job</Badge>
                    </Link>
                  ) : (
                    <Badge tone="wait">Not booked yet</Badge>
                  )}
                </div>
                <p>
                  {SERVICE_LABELS[lead.service]} · ZIP {lead.zip} · {lead.review ? "Needed your look before a price" : `Saw ${usd(lead.total ?? 0)}`}
                </p>
                <p className="text-muted">&ldquo;{lead.description}&rdquo;</p>
                <p className="text-muted">
                  First check {when(lead.createdAt)}
                  {lead.updatedAt !== lead.createdAt ? ` · last check ${when(lead.updatedAt)}` : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
