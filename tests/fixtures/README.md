# Test fixtures

Recorded-response-shaped fixtures for the source adapters (SPEC.md §14 Phase 0,
§15 "test with fixtures, not live calls").

**Provenance note:** these fixtures were hand-constructed to mirror each API's
documented response schema, because the build environment's network policy
blocked `api.fda.gov` and `www.fsis.usda.gov` at authoring time. Field names,
value formats, and quirks (bare `YYYYMMDD` dates, free-text
`distribution_pattern`, FSIS `field_*` strings, HTML in `field_summary`) match
the real APIs. To replace them with true recordings:

```bash
curl "https://api.fda.gov/food/enforcement.json?limit=5" \
  > tests/fixtures/openfda/enforcement-page.json   # then trim/anonymize as needed
curl -H "Accept: application/json" "https://www.fsis.usda.gov/fsis/api/recall/v/1" \
  | head -c 20000 > tests/fixtures/fsis/recalls.json
```

The `*-malformed.json` files intentionally contain broken records (missing IDs,
unparseable dates, wrong types) — adapters must skip them with a reason, never
crash, and never silently drop the valid records around them.
