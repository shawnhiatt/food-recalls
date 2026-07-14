"use client";

import { US_STATES } from "@/lib/states";
import { BIG_NINE_ALLERGENS, formatAllergenLabel, HAZARD_TYPE_LABEL, type HazardType } from "@/lib/copy";

export type FeedFilters = {
  state?: string;
  audience?: "human" | "pet";
  hazardType?: HazardType;
  allergen?: string;
  matchedOnly?: boolean;
};

const HAZARD_TYPES: HazardType[] = ["microbial", "allergen", "foreign_material", "other"];

// Filter chips (SPEC.md §8): plain-field filters over the national feed, plus
// "matched us" (Phase 6) — a toggle, not a <select>, since it's binary.
// Native <select> per element, styled as a pill — semantic HTML over a
// custom dropdown (pwa skill rule 7).
export function FilterBar({
  filters,
  onChange,
  showMatchedFilter = false,
}: {
  filters: FeedFilters;
  onChange: (next: FeedFilters) => void;
  /** Only offer "matched us" when the caller has a household to match against. */
  showMatchedFilter?: boolean;
}) {
  const hasActiveFilters = Boolean(
    filters.state || filters.audience || filters.hazardType || filters.allergen || filters.matchedOnly,
  );

  return (
    <div className="flex flex-wrap items-center gap-2 overflow-x-auto px-4 py-2" role="group" aria-label="Filter recalls">
      {showMatchedFilter && (
        <button
          type="button"
          aria-pressed={filters.matchedOnly ?? false}
          onClick={() => onChange({ ...filters, matchedOnly: filters.matchedOnly ? undefined : true })}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-medium"
          style={{
            background: filters.matchedOnly ? "var(--color-primary)" : "var(--color-card)",
            color: filters.matchedOnly ? "#fff" : "var(--color-foreground)",
            border: "1px solid var(--color-border)",
          }}
        >
          Matched us
        </button>
      )}
      <Chip
        label="State"
        value={filters.state ?? ""}
        onChange={(v) => onChange({ ...filters, state: v || undefined })}
        options={[{ value: "", label: "All states" }, ...US_STATES.map((s) => ({ value: s.code, label: s.name }))]}
      />
      <Chip
        label="Category"
        value={filters.audience ?? ""}
        onChange={(v) => onChange({ ...filters, audience: (v || undefined) as FeedFilters["audience"] })}
        options={[
          { value: "", label: "All categories" },
          { value: "human", label: "Human food" },
          { value: "pet", label: "Pet food" },
        ]}
      />
      <Chip
        label="Hazard"
        value={filters.hazardType ?? ""}
        onChange={(v) => onChange({ ...filters, hazardType: (v || undefined) as FeedFilters["hazardType"] })}
        options={[
          { value: "", label: "All hazards" },
          ...HAZARD_TYPES.map((h) => ({ value: h, label: HAZARD_TYPE_LABEL[h] })),
        ]}
      />
      <Chip
        label="Allergen"
        value={filters.allergen ?? ""}
        onChange={(v) => onChange({ ...filters, allergen: v || undefined })}
        options={[
          { value: "", label: "All allergens" },
          ...BIG_NINE_ALLERGENS.map((a) => ({ value: a, label: formatAllergenLabel(a) })),
        ]}
      />
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-medium underline"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function Chip({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const active = value !== "";
  return (
    <label
      className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-medium"
      style={{
        background: active ? "var(--color-secondary)" : "var(--color-card)",
        color: active ? "var(--color-primary-text)" : "var(--color-foreground)",
        border: "1px solid var(--color-border)",
      }}
    >
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none"
        aria-label={label}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
