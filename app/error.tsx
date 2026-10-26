"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="mx-auto max-w-lg space-y-3">
      <h1 className="font-display text-3xl font-semibold text-pine">Something went wrong</h1>
      <p className="text-sm text-muted">{error.message || "The page could not finish loading."}</p>
      <button type="button" className="rounded-md bg-pine px-4 py-2 text-sm font-semibold text-paper" onClick={() => reset()}>
        Try again
      </button>
    </section>
  );
}
