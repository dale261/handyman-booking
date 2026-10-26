import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";

export default async function AreaPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole("owner");
  const query = ((await searchParams).q || "").trim().toLowerCase();
  const zips = await getRepository().listZips();
  const rows = zips.filter((zip) => {
    if (!query) return true;
    return [zip.zip, zip.city, zip.county, zip.status].join(" ").toLowerCase().includes(query);
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-pine">Service area</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {zips.length} ZIPs in the 231 area code. Auto-book ZIPs can be held and invoiced immediately. Owner-review ZIPs, and any ZIP that is not on this list, wait for you. Miles are straight-line from Cadillac and are only a fallback when road miles are unavailable.
        </p>
      </div>
      <form className="flex max-w-md gap-2">
        <Input name="q" defaultValue={query} placeholder="ZIP, city, or county" aria-label="Filter ZIPs" />
        <button type="submit" className="h-10 rounded-md bg-pine px-4 text-sm font-semibold text-paper">Search</button>
      </form>
      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2 pr-3">ZIP</th>
                <th className="py-2 pr-3">City</th>
                <th className="py-2 pr-3">County</th>
                <th className="py-2 pr-3">Booking</th>
                <th className="py-2 text-right">Miles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((zip) => (
                <tr key={zip.zip} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-semibold">{zip.zip}</td>
                  <td className="py-1.5 pr-3">{zip.city}</td>
                  <td className="py-1.5 pr-3">{zip.county}</td>
                  <td className="py-1.5 pr-3">{zip.status === "auto_book" ? "Auto-book" : "Owner review"}</td>
                  <td className="py-1.5 text-right">{zip.milesFromCadillac ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-4 text-sm text-muted">No ZIP matches that search.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
