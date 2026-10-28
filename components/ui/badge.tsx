import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    tone: {
      ok: "bg-pine/10 text-pine",
      wait: "bg-copper/15 text-copper",
      stop: "bg-red-100 text-red-900",
      plain: "bg-black/5 text-ink",
    },
  },
  defaultVariants: { tone: "plain" },
});

export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
