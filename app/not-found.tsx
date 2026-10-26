import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-lg space-y-3">
      <h1 className="font-display text-3xl font-semibold text-pine">That page is not here</h1>
      <p>The job may belong to another account, or the link is old.</p>
      <Link href="/" className="font-semibold text-pine underline">
        Back to the start
      </Link>
    </section>
  );
}
