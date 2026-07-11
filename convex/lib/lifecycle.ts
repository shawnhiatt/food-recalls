// Lifecycle normalization (SPEC.md §10): raw source statuses map to
// active | completed | terminated | withdrawn | corrected. Unknown statuses map
// to 'active' — the safe direction is a recall that stays visible, not one that
// silently disappears.

export type Lifecycle =
  | "active"
  | "completed"
  | "terminated"
  | "withdrawn"
  | "corrected";

/** openFDA `status` values: Ongoing, Completed, Terminated, Pending. */
export function mapFdaLifecycle(rawStatus: string): Lifecycle {
  const status = (rawStatus ?? "").trim().toLowerCase();
  switch (status) {
    case "completed":
      return "completed";
    case "terminated":
      return "terminated";
    case "ongoing":
    case "pending":
      return "active";
    default:
      return "active";
  }
}

/**
 * FSIS lifecycle from `field_active_notice` ("True"/"False") with the closed
 * date as a fallback signal.
 */
export function mapFsisLifecycle(activeNotice: string, closedDate: string): Lifecycle {
  const active = (activeNotice ?? "").trim().toLowerCase();
  if (active === "true" || active === "active") return "active";
  if (active === "false" || active === "closed") return "completed";
  return (closedDate ?? "").trim() ? "completed" : "active";
}
