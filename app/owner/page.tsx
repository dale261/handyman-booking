import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { addDays, formatDate, formatMinutes, todayDetroit, usd } from "@/lib/format";
import { STATUS_LABEL, statusTone } from "@/lib/labels";
import { dayRoute } from "@/lib/services/booking";

export default async function OwnerDayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date || "") ? (query.date as string) : todayDetroit();
  const routes = await dayRoute(getRepository(), date);
  const prev = addDays(date, -1);
  const next = addDays(date, 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-pine">Day route</h1>
          <p className="text-sm text-muted">{formatDate(date)}. Live miles are the drive right now. Billed miles stay put once a job is paid.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link className="rounded-md border border-line bg-card px-3 py-1.5 font-semibold" href={`/owner?date=${prev}`}>Previous</Link>
          <Link className="rounded-md border border-line bg-card px-3 py-1.5 font-semibold" href={`/owner?date=${todayDetroit()}`}>Today</Link>
          <Link className="rounded-md border border-line bg-card px-3 py-1.5 font-semibold" href={`/owner?date=${next}`}>Next</Link>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {routes.map((route) => (
          <Card key={route.crewId}>
            <CardHeader>
              <CardTitle>{route.crewName}</CardTitle>
              <p className="text-sm text-muted">{route.members.join(", ") || "No one on this crew"} · {route.liveMiles.toFixed(1)} live miles</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {route.rows.length === 0 ? (
                <p className="text-sm text-muted">No stops.</p>
              ) : (
                route.rows.map((row, index) => (
                  <Link key={row.id} href={`/jobs/${row.id}`} className="block rounded-md border border-line px-3 py-2 text-sm hover:border-pine/40">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">{index + 1}. {formatMinutes(row.startMin)} · {row.label}</p>
                      <Badge tone={statusTone(row.status)}>{STATUS_LABEL[row.status]}</Badge>
                    </div>
                    <p>{row.customer}</p>
                    <p className="text-muted">{row.address}</p>
                    <p className="text-muted">
                      {row.fromLabel}: {row.liveMiles.toFixed(1)} live mi
                      {row.locked ? ` · billed ${row.billedMiles.toFixed(1)} mi locked · ${usd(row.fee)}` : ` · billed ${row.billedMiles.toFixed(1)} mi · ${usd(row.fee)}`}
                    </p>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
