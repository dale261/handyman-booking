"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SubmitButton({
  children,
  pendingLabel = "Working…",
  variant = "default",
  size = "default",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "default" | "copper" | "outline" | "ghost" | "danger";
  size?: "default" | "sm" | "lg";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
