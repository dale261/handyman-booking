"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SubmitButton({
  children,
  pendingLabel = "Working…",
  variant = "default",
  size = "default",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "default" | "copper" | "outline" | "ghost" | "danger";
  size?: "default" | "sm" | "lg";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name={name} value={value} variant={variant} size={size} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
