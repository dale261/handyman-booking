import { run } from "vitest";
const files = process.argv.slice(2);
(async () => {
  for (const file of files) await import(file);
  await run();
})();
