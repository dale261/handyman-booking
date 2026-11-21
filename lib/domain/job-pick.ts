/** A job as it appears in a crew member's pick list: enough to tell which job it is. */
export type PickJob = { id: string; scope: string; where: string; when: string };

/** The line shown in the list: the work, then the street, short enough for a phone. */
export function jobLine(job: PickJob): string {
  const work = job.scope.length > 44 ? `${job.scope.slice(0, 43)}…` : job.scope;
  const street = job.where.split(",")[0].trim();
  return street ? `${work} · ${street}` : work;
}
