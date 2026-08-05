import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function ErpAlerts({
  error,
  notice,
  className,
}: {
  error?: string | null;
  notice?: string | null;
  className?: string;
}) {
  if (!error && !notice) return null;
  return (
    <div className={cn("mb-4 space-y-3", className)}>
      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert className="border-[var(--ok)]/30 bg-[var(--ok)]/10 text-[var(--ok)]">
          <CheckCircle2 />
          <AlertDescription className="text-[var(--ok)]">{notice}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
