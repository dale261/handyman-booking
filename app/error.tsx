"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const detail =
    error.message && !error.message.includes("\n") && error.message.length < 180
      ? error.message
      : "Please try again. If it keeps happening, call eX Construction.";
  return (
    <section className="mx-auto max-w-lg space-y-3">
      <h1 className="font-display text-3xl font-semibold text-ink">Something went wrong</h1>
      <p className="text-sm text-muted">{detail}</p>
      <button type="button" className="rounded-md bg-pine px-4 py-2 text-sm font-semibold text-white" onClick={() => reset()}>
        Try again
      </button>
    </section>
  );
}
