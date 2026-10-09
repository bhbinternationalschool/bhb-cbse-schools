/**
 * Tata Motors Fleet Edge — where TimeBound alerts actually arrive.
 *
 * The TimeBound subscription points at /live, and Tata posts its ALERT
 * events to that URL with "/alerts" appended. Nothing answered here, so from
 * 3 Oct 2026 (when the push restarted) every alert — overspeed, panic SOS —
 * got a 404 and was dropped: 59 by 9 Oct, while the periodic details on
 * /live were accepted. Same handler as /live, /alerts and the root, which
 * dispatch on payload shape, so an alert landing here reaches the alert path.
 */

export { GET, POST, runtime } from "@/app/api/transport/fleet-edge/alerts/route";
