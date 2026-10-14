import { CRUD, type RbacFeatureDef, type RbacWholeModuleTab } from "@/lib/rbacFeatureCatalog/types";

/**
 * Transport — wired 6 Oct 2026 (transport-desk POST/GET, TransportWorkspace
 * tabs). Slices are TransportState keys.
 */
export const TRANSPORT_FEATURES: RbacFeatureDef[] = [
  {
    id: "transport.riders",
    module: "transport",
    label: "Riders & boarding points",
    blurb: "Put children and staff on a route and stop, handle transport requests and pin requests.",
    actions: CRUD,
    slices: ["assignments", "staffRiders"],
    tabs: ["planner", "riders", "requests", "rosters", "classRosters", "staffRiders"],
    routes: [
      "/api/transport/pin-request",
      "/api/transport/pins-received",
      "/api/transport/boarding-point",
      "/api/transport/boarding-audit",
      "/api/transport/route-change-notice",
    ],
  },
  {
    id: "transport.routes",
    module: "transport",
    label: "Routes & stops",
    blurb: "Routes, their stops, timings and shifts.",
    actions: CRUD,
    slices: ["routes"],
    tabs: ["routes"],
  },
  {
    id: "transport.fleet",
    module: "transport",
    label: "Vehicles & compliance",
    blurb: "Vehicles and their papers — insurance, PUC, fitness, permit, road tax and the rest (Compliance tab). Booking a paper's fee also needs Accounts · edit.",
    actions: CRUD,
    slices: ["vehicles", "insurancePolicies", "certificateRenewals"],
    tabs: ["fleet", "compliance"],
    routes: ["/api/transport/fleet-edge/vehicle-identity", "/api/transport/vehicle-docs"],
  },
  {
    id: "transport.fuel",
    module: "transport",
    label: "Fuel log",
    blurb: "Fuel stock, purchases and refills.",
    actions: CRUD,
    slices: ["fuelStockLocations", "fuelPurchases", "fuelRefillLogs"],
    tabs: ["fuel"],
  },
  {
    id: "transport.service",
    module: "transport",
    label: "Service & repairs",
    blurb: "Job cards and repair requests.",
    actions: CRUD,
    slices: ["serviceJobCards", "repairRequests"],
    tabs: ["service"],
  },
  {
    id: "transport.boarding",
    module: "transport",
    label: "Boarding register",
    blurb: "Who boarded and got off, run by run; the vehicle log book and its monthly reports. Holding edit reaches every bus; view reaches only the bus Staff → Duties or Fleet links the person to.",
    actions: ["view", "create", "edit"],
    slices: ["boardingEvents"],
    tabs: ["board", "register"],
  },
  {
    id: "transport.finance",
    module: "transport",
    label: "Dealers, loans & payables",
    blurb: "Dealers, payables, vehicle loans, EMIs and the transport fee policy.",
    actions: CRUD,
    slices: ["dealers", "payables", "vehicleLoans", "emiSchedule", "feePolicy"],
    tabs: ["dealers", "finance"],
  },
  {
    id: "transport.live",
    module: "transport",
    label: "Live tracking",
    blurb: "Live bus positions, halts and the Fleet Edge report.",
    actions: ["view"],
    slices: ["gpsPings"],
    tabs: ["live", "fleetDashboard"],
    routes: [
      "/api/transport/live",
      "/api/transport/live-positions",
      "/api/transport/halt-analysis",
      "/api/transport/fleet-edge/dashboard",
      "/api/transport/fleet-edge/events",
      "/api/transport/fleet-edge/notifications",
      "/api/transport/fleet-edge/vehicle-status",
    ],
  },
  {
    id: "transport.reports",
    module: "transport",
    group: "Reports",
    label: "Transport dashboard & reports (read only)",
    blurb: "The transport dashboard and every transport report (riders, routes, vehicles, renewals, fuel, boarding, loans) — see and download. Changes nothing.",
    actions: ["view"],
    // Read-only, and no slices (each list has one owner): transport-desk
    // serves this function every list the dashboard and the report
    // catalogue (lib/transportReportCatalog) read — TRANSPORT_REPORT_KEYS.
    tabs: ["dashboard", "reports"],
    // The dashboard's vehicle-papers strip reads this; saving needs edit,
    // which this function never holds.
    routes: ["/api/transport/vehicle-docs"],
  },
];

/** Tabs of these modules that only the whole-module grant opens, and why. */
export const TRANSPORT_WHOLE_MODULE_TABS: RbacWholeModuleTab[] = [];
