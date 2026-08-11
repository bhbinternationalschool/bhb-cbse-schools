"use client";

import { AlertTriangleIcon } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ErpError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[erp] route error", error);
  }, [error]);

  return (
    <EmptyState
      icon={AlertTriangleIcon}
      title="This page hit a problem."
      description={
        error.digest
          ? `Something went wrong loading this screen (ref ${error.digest}). Try again, or go back to the dashboard.`
          : "Something went wrong loading this screen. Try again, or go back to the dashboard."
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => reset()}>
            Try again
          </Button>
          <Button type="button" variant="outline" render={<a href="/home" />}>
            Back to dashboard
          </Button>
        </div>
      }
    />
  );
}
