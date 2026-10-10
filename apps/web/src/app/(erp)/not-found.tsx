import { CompassIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ErpNotFound() {
  return (
    <EmptyState
      icon={CompassIcon}
      title="Page not found"
      description="This screen doesn't exist, or you may not have access to it."
      action={
        <Button type="button" render={<a href="/home" />}>
          Back to dashboard
        </Button>
      }
    />
  );
}
