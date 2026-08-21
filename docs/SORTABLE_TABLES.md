# Sortable tables

Every ERP table can be made sortable in three lines. The machinery is shared, so
sorting behaves the same in Fees as it does in Transport.

- `lib/tableSort.ts` — the comparison rules. Pure, React-free, self-tested.
- `components/ui/erp-table-sort.tsx` — the `useTableSort` hook and `ErpSortTh`.

## Adding it to a table

**1. Describe the columns by what they *yield*, not what they render.**

```tsx
const sort = useTableSort(
  riders,
  {
    name: (r) => r.fullName,
    classLabel: (r) => r.classLabel,
    km: (r) => (r.distanceKm > 0 ? r.distanceKm : null),
    fee: (r) => r.monthlyFeePaise,
  },
  "name", // initial column
);
```

**2. Swap the `<th>`s you want sortable.**

```tsx
<ErpSortTh sort={sort} field="name">Student</ErpSortTh>
<ErpSortTh sort={sort} field="fee" align="right">Per month</ErpSortTh>
```

Leave plain `<th>` for columns that carry no order — a thumbnail, a row of
buttons.

**3. Map `sort.rows` instead of the raw array.**

```tsx
{sort.rows.map((r) => ( … ))}
```

That is the whole change. TypeScript infers the field names from the columns
object, so a typo in `field=` is a compile error rather than a dead heading.

## The two mistakes worth avoiding

**Sort the value, not the cell.** A column showing `₹2,500` must yield
`monthlyFeePaise`, not the formatted string — otherwise ₹10,000 sorts before
₹2,500 because "1" precedes "2". This is the usual reason table sorting feels
broken. The same applies to dates rendered as `10 Aug`: yield the ISO string.

**A blank is unknown, not zero.** `tableSort` sinks empty cells to the bottom in
*both* directions, and that is deliberate. A student with no roll number is not
"roll number zero"; a stop with no measured distance is not "nearest". Yield
`null` for a missing value rather than `0` or `""` and the rule applies itself.
Note that `0` is a real value and stays with the numbers.

## What you get for free

- Natural ordering — "Class 10" after "Class 9", roll 2 before roll 10
- Case-insensitive names, so `banerjee` sits between `Ahmed` and `Chopra`
- Stable ties, so re-sorting never shuffles equal rows
- `aria-sort` on the header and a real `<button>`, so the column is keyboard
  reachable and announced by a screen reader
- Clicking a new column starts ascending; clicking the same one flips

## Where it is applied

- `components/transport/FleetRosterPanel.tsx` — riders by bus
- `components/students/BirthdaysPanel.tsx` — today's birthdays
- `components/staff/StaffWorkspace.tsx` — staff roster
- `components/library/LibraryWorkspace.tsx` — catalogue

## The real scope, and what to skip

68 components render roughly **147 tables** between them (294 `ErpTableHead`
occurrences, 627 `<th>` cells). That is a lot more than it looks from the
component count, and it is not a job for one sweep.

**About 40 of those files already sort their rows deliberately.** Do not
blanket-convert them. `StockMasterWorkspace`'s category list, for instance,
orders by `sortOrder` then name — a sequence somebody arranged on purpose.
Bolting a sortable header onto it would fight the arrangement rather than help.
Leave those alone unless the manual order is genuinely incidental.

Others are not lists at all: a totals row, a five-row summary, a timetable grid
whose rows are periods, a fee schedule whose rows run April to March. Row order
there *is* information. Sorting it destroys the thing the reader came for.

So the checklist per table is:

1. Is it a list somebody hunts through? If not, skip it.
2. Does the current order mean something? If yes, skip it.
3. Otherwise apply the recipe above — and read each column, because the whole
   value is in yielding the right underlying field.

Work module at a time and look at the result. A wrong column getter compiles
perfectly and only shows up when a clerk sorts by fee and sees nonsense.
