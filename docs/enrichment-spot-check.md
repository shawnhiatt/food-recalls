# Phase 0 enrichment spot-check (SPEC.md §14)

**Date:** 2026-07-11 · **Dataset:** live dev deployment, 29,215 openFDA records
(post-backfill) · **Reviewer:** manual review of extracted text vs. stored tags.

## Method

120 records pulled via `audit:samplePage` (internal operator query), stratified
by era across the table's full history — three contiguous 40-record slices of
the `by_recall_date` index, newest-first:

| Stratum | Anchor | Records |
|---|---|---|
| Recent | newest | 40 |
| Mid | ≤ 2019-12-31 | 40 |
| Early | ≤ 2013-12-31 | 40 |

For each record the reviewer compared `productDesc` + `reason_for_recall`
against the stored `allergens` and `audience` tags.

**Ground truth is text-extraction, not ingredient inference** — the enrichment
contract (§4) is a tagging pass over the record's text. A cheese bread whose
text never says "wheat" is not counted as a wheat miss; a record whose text
says "cheddar" without a milk tag **is** counted as a milk miss.

Sampling caveat: contiguous index slices cluster around recall events (e.g.
one cookie bakery's 12 simultaneous recalls appear together in the Early
stratum). Fine for measuring extraction quality — every record is still
independently tagged — but the strata are not independent draws.

## Results

### Allergen tagging — target ≥95% recall → **96.8% PASS**

| Stratum | Named-allergen instances | Captured | Missed | Recall |
|---|---|---|---|---|
| Recent | 39 | 37 | 2 | 94.9% |
| Mid (2019) | 41 | 39 | 2 | 95.1% |
| Early (2013) | 45 | 45 | 0 | 100% |
| **Total** | **125** | **121** | **4** | **96.8%** |

All four misses are one root cause — cheese-variety names absent from the
milk pattern:

| Record | Text | Missed tag |
|---|---|---|
| H-1111-2026 | "Roast beef and **cheddar**… Turkey & **Cheddar** Sub" | milk |
| H-0947-2026¹ | "Nutrisystem, Chocolate **Cheesecake**" | milk |
| F-0596-2020 | "HARD-COOKED EGG SALAME & **PROVOLONE**" | milk |
| F-0595-2020 | "HARD-COOKED EGG BACON & **CHEDDAR**" | milk |

¹ Sample row 25 of the Recent stratum; soy (the recalled allergen) was
correctly captured.

**Action taken (2026-07-11):** cheese-variety synonyms (cheddar, provolone,
mozzarella, parmesan, gouda, brie, feta, ricotta, cheesecake, buttermilk,
custard) added to the milk pattern in `convex/lib/enrichment.ts` with unit
coverage. All four sampled misses are captured by the updated pattern.
Retagging applies to records ingested or materially updated after the change;
historical records keep their tags unless the backfill is re-run (tag changes
alter the content hash, so a re-run would retag them as material revisions —
per §15, tags are correctable and raw records are always kept).

False positives observed (not counted against recall; §4 deliberately biases
toward them): "Butter Creek Farms" firm name tagging milk on cookie recalls;
"wheat/dairy/soy free" claims tagging wheat/milk/soy on cashew-cheese
products; donor human milk tagging milk. All harmless-by-design: an extra
alert beats a missed one.

### Audience classification — target ≥90% accuracy → **100% PASS**

120/120 sampled records are human food and all are tagged `human` (or would
display under human). Zero misclassifications.

Caveat: the sample contained no pet-food records — they are a small fraction
of the enforcement dataset and none fell in the sampled slices. Pet-food
classification (including the false-negative bias: pet requires a strong
signal) is covered by fixture-based unit tests in `tests/enrichment.test.ts`
and `tests/openfda.adapter.test.ts` ("dog food recall classifies as pet
audience"). Worth re-sampling specifically for pet records if pet-food
matching becomes load-bearing in Phase 2.

## Verdict

Both §14 Phase 0 enrichment gates pass on real ingested data. The one
systematic failure mode found (cheese varieties) is fixed and covered by
tests.
