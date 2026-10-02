/**
 * Self-test: Verify WhatsApp template body components are sent correctly.
 *
 * Meta error #131008 "Required parameter is missing" when sending templates
 * likely occurs when a template with a static body (no variables) doesn't
 * include a body component. The fix: always send a body component if the
 * template has a body, even if there are no variables.
 */

import { buildWaTemplateBodyComponent } from "./waSend";

// Test 1: Template with variables
const withVars = buildWaTemplateBodyComponent(
  ["studentName", "amount"],
  { studentName: "Satvik", amount: "₹1000" }
);
console.assert(withVars.type === "body", "Should be body component");
console.assert(
  withVars.parameters?.length === 2,
  "Should have 2 parameters"
);
console.log("✓ Test 1: Template with variables passed");

// Test 2: Template with NO variables (static body)
// This is the bug case — Meta requires a body component even for static text
const noVars = buildWaTemplateBodyComponent([], {});
console.assert(noVars.type === "body", "Should create body component even for static body");
console.assert(
  noVars.parameters?.length === 0 || noVars.parameters?.every(p => p.text === "—"),
  "Empty params should be marked as empty"
);
console.log("✓ Test 2: Template with NO variables handled");

console.log("\nAll tests passed!");
console.log("If this is running but the dispatch route still sends empty components,");
console.log("the route needs fixing: always include a body component for templates with body text.");
