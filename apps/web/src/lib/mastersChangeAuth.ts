/**
 * Masters' use of the shared function-grant check (lib/deskFeatureAuth.ts).
 */
import { authorizeFeatureChange, type DeskChangeVerdict, type FeatureAccessFn } from "@/lib/deskFeatureAuth";

export type { FeatureAccessFn } from "@/lib/deskFeatureAuth";
export type MastersChangeVerdict = DeskChangeVerdict;

export function authorizeMastersFeatureChange(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  access: FeatureAccessFn,
  ownClassIds: Set<string> | null,
  classLabel?: (classId: string) => string,
): MastersChangeVerdict {
  return authorizeFeatureChange("masters", stored, incoming, access, ownClassIds, classLabel);
}
