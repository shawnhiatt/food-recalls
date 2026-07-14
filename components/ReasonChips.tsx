import { reasonChipLabel, type MatchDimension } from "@/lib/copy";

// §8 reason chips on matched cards: "Your state," "Allergen: milk," "Publix,"
// "Pet," "Infant risk." Chain matches (always 'possible', §7/§14 Phase 6) get
// a dashed outline instead of a filled pill — visually distinct from a
// confirmed match without a wall of extra text on the card itself; the full
// "possible match" explanation (§11) lives on the Detail page.
export function ReasonChips({
  matchedOn,
  matchedDetails,
  className = "",
}: {
  matchedOn: MatchDimension[];
  matchedDetails: Partial<Record<MatchDimension, string[]>>;
  className?: string;
}) {
  if (matchedOn.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {matchedOn.map((dimension) => {
        const possible = dimension === "chain";
        return (
          <li
            key={dimension}
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={
              possible
                ? {
                    background: "transparent",
                    border: "1px dashed var(--color-primary)",
                    color: "var(--color-primary-text)",
                  }
                : { background: "var(--color-primary)", color: "#fff" }
            }
          >
            {reasonChipLabel(dimension, matchedDetails[dimension])}
          </li>
        );
      })}
    </ul>
  );
}
