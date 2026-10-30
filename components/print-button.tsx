"use client";

import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog, where phones and computers can also save a PDF. */
export function PrintButton({ variant = "outline", size = "default" }: { variant?: "default" | "outline"; size?: "default" | "sm" }) {
  return (
    <Button type="button" variant={variant} size={size} onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
