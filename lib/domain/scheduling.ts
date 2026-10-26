export type BusyWindow = [number, number];

export function visitWindow(
  startMin: number,
  driveMin: number,
  onsiteMin: number,
  bufferMin: number,
): { reserveStart: number; reserveEnd: number } {
  return {
    reserveStart: startMin - driveMin - bufferMin,
    reserveEnd: startMin + onsiteMin + bufferMin + driveMin,
  };
}

export function workerFree(
  worker: { dayStart: number; dayEnd: number },
  busy: BusyWindow[],
  reserveStart: number,
  reserveEnd: number,
): boolean {
  if (reserveEnd <= reserveStart) return false;
  if (reserveStart < worker.dayStart || reserveEnd > worker.dayEnd) return false;
  return busy.every(([b0, b1]) => reserveEnd <= b0 || reserveStart >= b1);
}

export type CrewCandidate = {
  crewId: string;
  distanceMiles: number;
  jobCount: number;
  freeMemberIds: string[];
};

export type CrewChoice = {
  crewId: string;
  memberIds: string[];
  distanceMiles: number;
  distanceTie: boolean;
  borrowed: boolean;
};

/**
 * Among crews that have someone free, pick the closest previous stop
 * (or the shop). A distance tie goes to the crew with fewer jobs that day.
 * If that crew is short of people, borrow free workers from the next closest crews.
 * Travel distance stays the primary crew's distance.
 */
export function chooseCrew(candidates: CrewCandidate[], needed: number): CrewChoice | null {
  const usable = candidates
    .filter((c) => c.freeMemberIds.length > 0)
    .sort(
      (a, b) =>
        a.distanceMiles - b.distanceMiles || a.jobCount - b.jobCount || a.crewId.localeCompare(b.crewId),
    );
  if (usable.length === 0) return null;
  const primary = usable[0];
  const memberIds: string[] = [];
  for (const crew of usable) {
    for (const id of crew.freeMemberIds) {
      if (memberIds.length >= needed) break;
      if (!memberIds.includes(id)) memberIds.push(id);
    }
    if (memberIds.length >= needed) break;
  }
  if (memberIds.length < needed) return null;
  const chosen = memberIds.slice(0, needed);
  const distanceTie =
    usable.length > 1 && usable[0].distanceMiles === usable[1].distanceMiles;
  const borrowed = chosen.some((id) => !primary.freeMemberIds.includes(id));
  return {
    crewId: primary.crewId,
    memberIds: chosen,
    distanceMiles: primary.distanceMiles,
    distanceTie,
    borrowed,
  };
}

export type RouteStopInput = {
  id: string;
  startMin: number;
  label: string;
  address: string;
  liveLegMiles: number;
  travelLocked: boolean;
  lockedMiles: number | null;
};

export type RouteStopRow = {
  id: string;
  order: number;
  startMin: number;
  label: string;
  address: string;
  liveLegMiles: number;
  billedMiles: number;
  fromLabel: string;
  locked: boolean;
  drifted: boolean;
};

export function crewRoute(stops: RouteStopInput[]): { rows: RouteStopRow[]; liveMiles: number; billedMiles: number } {
  const ordered = [...stops].sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id));
  let live = 0;
  let billed = 0;
  const rows: RouteStopRow[] = ordered.map((s, i) => {
    const locked = s.travelLocked && s.lockedMiles != null;
    const billedMiles = locked ? s.lockedMiles! : s.liveLegMiles;
    live += s.liveLegMiles;
    billed += billedMiles;
    return {
      id: s.id,
      order: i + 1,
      startMin: s.startMin,
      label: s.label,
      address: s.address,
      liveLegMiles: s.liveLegMiles,
      billedMiles,
      fromLabel: i === 0 ? "Shop to job 1" : `Job ${i} to job ${i + 1}`,
      locked,
      drifted: locked && Math.abs(billedMiles - s.liveLegMiles) > 0.05,
    };
  });
  return { rows, liveMiles: live, billedMiles: billed };
}

const BLOCKING = new Set([
  "held",
  "pending_area",
  "booked",
  "in_progress",
  "awaiting_approval",
  "disputed",
  "balance_due",
  "completed",
  "reviewed",
  "cancel_requested",
]);

export function blocksSchedule(status: string): boolean {
  return BLOCKING.has(status);
}

export function previousJob<T extends { crewId: string | null; startMin: number | null; status: string }>(
  jobs: T[],
  crewId: string,
  startMin: number,
): T | null {
  const prior = jobs
    .filter(
      (j) => j.crewId === crewId && j.startMin != null && j.startMin < startMin && blocksSchedule(j.status),
    )
    .sort((a, b) => (b.startMin ?? 0) - (a.startMin ?? 0));
  return prior[0] ?? null;
}
