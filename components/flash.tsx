export function Flash({ notice, error }: { notice?: string; error?: string }) {
  if (!notice && !error) return null;
  const problem = Boolean(error);
  return (
    <p
      role="status"
      className={problem ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" : "rounded-md border border-pine/20 bg-pine/10 px-3 py-2 text-sm text-pine"}
    >
      {error || notice}
    </p>
  );
}
