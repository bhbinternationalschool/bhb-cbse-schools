import type { RbacAction, RbacModule } from "@/lib/rbac";

export type RbacFeatureId = string;

export type RbacFeatureDef = {
  /** "<module>.<function>", stable — stored in roles. */
  id: RbacFeatureId;
  module: RbacModule;
  label: string;
  blurb: string;
  /** The actions that mean something for this function. */
  actions: RbacAction[];
  /**
   * The module's DESK state keys this function owns (the body its
   * school-data/*-desk route saves). A function-only save lifts in these
   * keys only, row by row — lib/deskFeatureAuth.ts.
   */
  slices?: string[];
  /** Rows carry a class; a function holder touches only their own classes. */
  classScoped?: boolean;
  /** The row field naming the class (default "classId"). */
  classKey?: string;
  /**
   * The store is merged by id on the server: a row missing from a push is a
   * stale copy, never a deletion (and so needs no delete grant).
   */
  unionRows?: boolean;
  /** Tab ids of the module's screen this function opens. */
  tabs?: string[];
  /**
   * API path prefixes (e.g. "/api/transport/fleet") that this function
   * reaches on its own — requireStaffPermission accepts the function there
   * in place of the module grant. The route is not class-limited by this:
   * a route that serves class data must apply the teacher's scope itself.
   */
  routes?: string[];
};

export const CRUD: RbacAction[] = ["view", "create", "edit", "delete"];
