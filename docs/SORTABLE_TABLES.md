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

Roughly 79 components use `ErpTable` / `ErpTableShell`. The rest are a
mechanical follow-on using the recipe above; do them a module at a time and
look at each one, rather than in a single sweep.
