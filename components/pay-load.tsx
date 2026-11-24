"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { checkPayFileAction, loadPayFileAction } from "@/lib/actions";
import type { LoadChoices, LoadSummary } from "@/lib/domain/pay-load";

const SELECT = "h-10 w-full min-w-0 rounded-md border border-line bg-card px-3 font-normal";
const NEW_PERSON = "new";
const SHOWN = 20;

function usd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function standing(owed: number): string {
  if (owed > 0) return `Owed ${usd(owed)}`;
  if (owed < 0) return `Paid ahead ${usd(-owed)}`;
  return "Paid up";
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

type Done = { added: number; linked: number; skipped: number; removed: number; people: string[] };

/**
 * Load the owner's own pay records from a file. Two steps: check the file, which shows
 * who each name is, which jobs were found and what everyone would be owed, then load it.
 * Nothing is saved by the check.
 */
export function PayLoad() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [choices, setChoices] = useState<LoadChoices>({});
  const [plan, setPlan] = useState<LoadSummary | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [pending, start] = useTransition();

  function check(nextText: string, nextChoices: LoadChoices) {
    setError("");
    setDone(null);
    if (!nextText.trim()) {
      setPlan(null);
      setError("Choose the file, or paste what's in it, first.");
      return;
    }
    start(async () => {
      try {
        const result = await checkPayFileAction(nextText, nextChoices);
        if (!result.ok) {
          setPlan(null);
          setError(result.error);
          return;
        }
        setPlan(result.data);
        setChoices(Object.fromEntries(result.data.people.map((person) => [person.name, person.choice])));
      } catch {
        setError("The site didn't answer. Check your signal and try again.");
      }
    });
  }

  function load() {
    setError("");
    start(async () => {
      try {
        const result = await loadPayFileAction(text, choices);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDone(result.data);
        setPlan(null);
      } catch {
        setError("The site didn't answer, so it may not have finished. Check the file again and load it again: loading twice is safe.");
      }
    });
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    const read = await file.text();
    setFileName(file.name);
    setText(read);
    setChoices({});
    check(read, {});
  }

  function choose(name: string, value: string) {
    const next = { ...choices, [name]: value };
    setChoices(next);
    check(text, next);
  }

  return (
    <div className="grid grid-cols-1 gap-4 text-sm">
      <div className="grid grid-cols-1 gap-3">
        <label className="grid min-w-0 grid-cols-1 gap-1 font-semibold">
          The records file
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(event) => pick(event.target.files?.[0])} className="w-full min-w-0 rounded-md border border-line bg-card px-3 py-2 font-normal" />
        </label>
        <label className="grid min-w-0 grid-cols-1 gap-1 font-semibold">
          <span>
            Or paste what&apos;s in it <span className="font-normal text-muted">(the first line names the columns)</span>
          </span>
          <textarea
            rows={3}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setFileName("");
              setPlan(null);
              setDone(null);
            }}
            className="w-full min-w-0 rounded-md border border-line bg-card px-3 py-2 font-mono text-xs font-normal"
            placeholder="date,worker,job,job_number,hours,rate,pay,note"
          />
        </label>
        {fileName && <p className="text-muted">Read {fileName}.</p>}
        <div>
          <button type="button" onClick={() => check(text, choices)} disabled={pending} className="h-10 rounded-md border border-pine px-4 text-sm font-semibold text-pine disabled:opacity-60">
            {pending && !plan ? "Checking…" : "Check the file"}
          </button>
        </div>
        <p className="text-muted">Checking saves nothing. You see what would happen first.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900">
          {error}
        </p>
      )}

      {done && (
        <div role="status" className="space-y-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
          <p className="font-semibold">Loaded {count(done.added, "line", "lines")}.</p>
          {done.linked > 0 && <p>{count(done.linked, "of them was", "of them were")} put on hours already logged on the site.</p>}
          {done.skipped > 0 && <p>{count(done.skipped, "line was", "lines were")} already on the site and left alone.</p>}
          {done.removed > 0 && <p>{count(done.removed, "line", "lines")} from an earlier load {done.removed === 1 ? "was" : "were"} taken off.</p>}
          {done.people.length > 0 && <p>Added to the crew list, with no sign-in: {done.people.join(", ")}.</p>}
          <p>
            <Link className="font-semibold underline" href="/owner/pay">
              See what everyone is owed
            </Link>
          </p>
        </div>
      )}

      {plan && (
        <div className="grid grid-cols-1 gap-4">
          <p className="font-display text-xl font-semibold">Here&apos;s what loading it would do</p>

          {plan.problems.length > 0 && (
            <div role="alert" className="space-y-1 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900">
              <p className="font-semibold">{count(plan.problems.length, "line can't", "lines can't")} be read. Nothing can be loaded until the file is fixed.</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {plan.problems.slice(0, SHOWN).map((problem) => (
                  <li key={problem} className="break-words">
                    {problem}
                  </li>
                ))}
              </ul>
              {plan.problems.length > SHOWN && <p>And {plan.problems.length - SHOWN} more.</p>}
            </div>
          )}

          <div className="space-y-1">
            <p className="font-semibold">In the file: {count(plan.read, "line", "lines")}</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {plan.counts.hourly > 0 && <li>{count(plan.counts.hourly, "line", "lines")} of hours at a rate</li>}
              {plan.counts.flat > 0 && <li>{count(plan.counts.flat, "flat amount", "flat amounts")}</li>}
              {plan.counts.payments > 0 && <li>{count(plan.counts.payments, "payment", "payments")}</li>}
              {plan.counts.tracked > 0 && <li>{count(plan.counts.tracked, "line", "lines")} of hours with no pay. They&apos;re kept as tracked hours at $0.</li>}
            </ul>
            <p>
              <span className="font-semibold">Loading saves {count(plan.counts.adding, "line", "lines")}.</span>
              {plan.counts.linked > 0 ? ` ${count(plan.counts.linked, "of them matches", "of them match")} hours already logged on the site, so the rate goes on those hours and nothing is added twice.` : ""}
              {plan.counts.skipped > 0 ? ` ${count(plan.counts.skipped, "line is", "lines are")} already on the site and will be left alone.` : ""}
              {plan.counts.replaced > 0 ? ` This replaces the ${count(plan.counts.replaced, "line", "lines")} loaded before.` : ""}
            </p>
          </div>

          <div className="space-y-2">
            <p className="font-semibold">Who each name is</p>
            <p className="text-muted">Check these. Change any that are wrong.</p>
            <ul className="grid grid-cols-1 gap-2">
              {plan.people.map((person) => (
                <li key={person.name} className="grid min-w-0 grid-cols-1 gap-1 rounded-md border border-line px-3 py-2">
                  <label className="grid min-w-0 grid-cols-1 gap-1">
                    <span>
                      <span className="font-semibold">{person.name}</span> <span className="text-muted">· {count(person.rows, "line", "lines")}</span>
                    </span>
                    <select value={choices[person.name] ?? person.choice} disabled={pending} onChange={(event) => choose(person.name, event.target.value)} className={SELECT}>
                      <option value={NEW_PERSON}>Not on the crew list: add by name</option>
                      {plan.crew.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.fullName}
                          {worker.active ? "" : " (not on the crew list)"}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          {plan.jobs.length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold">Jobs with a number</p>
              <ul className="grid grid-cols-1 gap-2">
                {plan.jobs.map((job) => (
                  <li key={job.number} className="min-w-0 rounded-md border border-line px-3 py-2 break-words">
                    <span className="font-semibold">{job.label}</span> <span className="text-muted">· {count(job.rows, "line", "lines")}</span>
                    {job.found ? (
                      <span className="block">
                        Found in the app: {job.found.scope}
                        {job.found.where ? <span className="block text-muted">{job.found.where}</span> : null}
                      </span>
                    ) : (
                      <span className="block text-muted">No job with that number in the app. The name is kept on each line.</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.warnings.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              <p className="font-semibold">Worth a look</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {plan.warnings.slice(0, SHOWN).map((warning) => (
                  <li key={warning} className="break-words">
                    {warning}
                  </li>
                ))}
              </ul>
              {plan.warnings.length > SHOWN && <p>And {plan.warnings.length - SHOWN} more.</p>}
            </div>
          )}

          <div className="space-y-2">
            <p className="font-semibold">What everyone would be owed after loading</p>
            <p className="text-muted">Check these against your own records before you load.</p>
            <ul className="grid grid-cols-1 gap-1.5">
              {plan.after.map((person) => (
                <li key={person.name} className="rounded-md border border-line px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{person.name}</span>
                    <span className="font-semibold">{standing(person.owed)}</span>
                  </div>
                  <p className="text-muted">
                    Earned {usd(person.earned)} · Paid {usd(person.paid)}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <button type="button" onClick={load} disabled={pending || plan.problems.length > 0} className="h-11 rounded-md bg-pine px-5 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "Working…" : `Load ${count(plan.counts.adding, "line", "lines")}`}
            </button>
            <p className="text-muted">Loading again later replaces what was loaded, so a newer file never doubles up.</p>
          </div>
        </div>
      )}
    </div>
  );
}
