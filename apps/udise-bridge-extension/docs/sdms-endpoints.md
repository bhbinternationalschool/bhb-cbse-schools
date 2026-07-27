# SDMS endpoint discovery notes

Populate this file as **Network probe** captures real traffic from a logged-in SDMS session.

## Known public entry points

| Purpose | URL |
|---------|-----|
| SDMS login | `https://sdms.udiseplus.gov.in/p2/v1/login` |
| Portal hub | `https://udiseplus.gov.in` |

## To document (from probe logs)

After login, navigate: **Student Module → Students List → Export**

Record:

- Export/download URL (method, path, query)
- Content-Type of response
- Whether session cookie / CSRF header is required

### Template

```
### Students List export
- Method: GET | POST
- Path: /...
- Headers: ...
- Response: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
- Notes: ...
```

## v1 shipping path

Until endpoints are confirmed, the bridge uses **fetch/XHR response capture** when the portal returns an Excel blob (same as clicking Export in the UI). No hardcoded private API calls in v1.

## Adding a stable adapter (future)

1. Confirm endpoint in probe logs from a real school session
2. Add adapter in `background/service-worker.js` (authenticated `fetch` with `credentials: 'include'`)
3. Fall back to export capture if adapter returns non-200
