# The Premium Grid Standard

Every data-heavy screen carries the same three rows, top to bottom:

1. **Metric cards** — three or four live summaries (`ErpMetricGrid` /
   `ModuleDashboardHost`, or a module-specific stats strip such as
   `StudentStatsDashboard`).
2. **Unified control bar** — search, filter toggles, contextual actions and
   an **Export data** menu (`ErpControlBar`, `FilterBar`, `ExportMenu`).
3. **Data grid with inline controls** — a checkbox on every row, a `…`
   action menu on every row, and a bulk bar that slides up the moment a row
   is ticked (`DataTable`, or `RowCheckbox` + `RowActionMenu` +
   `BulkActionBar` inside a bespoke list).

The kit lives in `apps/web/src/components/ui/erp-grid.tsx`; `DataTable`
(`ui/data-table.tsx`) composes all of it, so a new screen gets the whole
standard from one component:

```tsx
<DataTable
  columns={cols}
  rows={rows}
  rowKey={(r) => r.id}
  toolbar={<FilterBar … />}
  exportFileBaseName="fee_defaulters"
  exportTitle="Fee defaulters"
  rowActions={[
    { id: "view", label: "View details", onSelect: open },
    { id: "wa", label: "Send WhatsApp", onSelect: wa, disabled: (r) => !r.mobile },
    { id: "ledger", label: "Fee ledger & receipts", onSelect: ledger },
  ]}
  bulkActions={[
    { id: "wa", label: "Send WhatsApp", onRun: bulkWa },
    { id: "pdf", label: "Generate PDFs", onRun: bulkPdf },
  ]}
/>
```

## Rules

- **Row menu on every row.** View / Edit / Send WhatsApp / History at
  minimum; destructive items go last, `tone: "danger"`, `separatorAbove`.
- **Selection is per screen.** `useRowSelection(knownKeys)` keeps ticks
  across filter changes and drops keys that disappear.
- **Export what is on screen.** `ExportMenu.rows` is a function so it reads
  the filtered, sorted set at click time. Excel gets auto widths, a frozen
  header and autofilter; PDF is landscape and banded (`lib/reportExport.ts`).
- **Previews open in overlays**, never new browser windows.
- **Reads page.** Any server read of a table that can exceed 1,000 rows goes
  through `lib/supabase/pageAll.ts` (`fetchAllPages`, `fetchByIds`).
  PostgREST reports a truncated result as success; it has already cost this
  system receipt lines, a controls page that saw 40% of the ledger, and an
  attendance desk that hydrated 1,000 of 10,315 marks.

## Enforcement

`scripts/ratchets.txt` → `grids_without_row_menu`: component files that
render a grid but carry no row menu. It only goes down.

## Rollout (2026-09-06)

Every operational grid in `apps/web/src/components` now carries a row menu;
the `grids_without_row_menu` ratchet is at **0** and stays there.

**How each kind was converted**

- Screens with hand-rolled row buttons (Students, Staff, Admissions leads,
  Library, Visitors, Payroll runs and lines, Store catalogue / stock / assets /
  vendors / purchase orders, Exams date sheet / blueprint / remarks, Transport
  fleet roster, Timetable substitutions, Website pages, Roles, Teaching log,
  Trust allotments / loans / cost lines, Inter-school registrations,
  Admissions campaigns / KB / marketing / referrals / survey team / field
  survey, Birthdays, Cheques): buttons folded into `RowActionMenu`; the one
  primary action a clerk hits all day (Take fee, Taught, AI draft, Check out)
  stays as a button beside the menu.
- Read-only rosters that name a person (attendance, PF/ESI returns, bank
  file, free periods, GPS presence, leave registers, outdoor duty, tags,
  update sheet, class transport, agreements, store dues): a menu with **Open
  student profile / Open staff record**, plus `exportAs` on the shell.
- Tables that used the shared `DeskListActions` (duty roster, homework and
  others): converted in one step — that component now renders the menu.
- `ErpTableShell exportAs="…"` gives any table an **Export data** menu that
  reads the rendered rows; 40+ shells carry it.

**Exempt, with the reason written at the top of each file**
(`ratchet-allow: grids_without_row_menu — …`): marks-entry and period grids,
line editors inside forms, report output with dynamic columns, detail tables
inside dialogs, telemetry and plan summaries, append-only logs, the two
UDISE+ reconciliation screens (their rows carry bespoke match-state controls),
and the legacy browser-book accounts desk that phase C is retiring.

**Selection + bulk bar** is live on Students (status, WhatsApp, register PDF,
UDISE+ Excel), Staff (status, WhatsApp), Admissions leads (WhatsApp),
Admissions registrations (WhatsApp), Transport fleet roster (suspend / resume
boarding) and Staff attendance (mark all selected P / A / HD / L…). Adding it
elsewhere is `useRowSelection` + `RowCheckbox` + `BulkActionBar`, or
`bulkActions` on `DataTable`. Fee defaulters already had its own selection.
