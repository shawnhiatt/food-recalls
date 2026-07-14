"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { formatRelativeTime } from "@/lib/format";
import { archivedRecallExplanation, NO_KNOWN_RECALL_COPY, sameManufacturerExplanation } from "@/lib/copy";

// Scanner tab (SPEC.md §12, Phase 7): camera UPC scan (in-store check +
// pantry audit) with always-available manual entry, scan-to-pantry
// persistence (every scan is recorded, doubling as scan history), and a
// live pantry list that auto-matches newly ingested recalls (§7, §14) with
// no extra wiring — `pantry.matches` is a reactive query.
export default function ScannerPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const context = useQuery(api.household.getMyContext, {});

  if (isLoading || context === undefined) return <Centered>Loading…</Centered>;

  if (!isAuthenticated || !context.signedIn) {
    return (
      <Prompt
        title="Scan before you buy — or check your pantry"
        body="Sign in to scan barcodes against active recalls and keep a pantry list that keeps checking itself."
        cta="Sign in"
        href="/signin"
      />
    );
  }

  if (context.needsOnboarding) {
    return (
      <Prompt
        title="Finish setting up"
        body="Finish household setup first so scanned items save to your pantry."
        cta="Start setup"
        href="/onboarding"
      />
    );
  }

  return <ScannerView />;
}

type ScanOutcome = {
  status: "recall" | "same_manufacturer" | "archived_recall" | "no_known_recall";
  productName?: string;
  brand?: string;
  resolvedYear?: string;
  matchedRecalls: Array<{ _id: Id<"recalls">; title: string; firm: string }>;
};

function ScannerView() {
  const scanUpc = useAction(api.pantry.scanUpc);
  const pantry = useQuery(api.pantry.matches, {});
  const removeItem = useMutation(api.pantry.remove);

  const [cameraActive, setCameraActive] = useState(false);
  const [manualUpc, setManualUpc] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runScan(upc: string) {
    const trimmed = upc.trim();
    if (!trimmed || busy) return;
    setCameraActive(false);
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await scanUpc({ upc: trimmed });
      setOutcome(result);
      setManualUpc("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check that barcode. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 py-4 pb-8">
      <h1 className="text-xl font-black" style={{ color: "var(--color-foreground)" }}>
        Scanner
      </h1>
      <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        Scan a barcode before you buy, or work through your pantry — scanned items are saved
        and get checked again automatically as new recalls come in.
      </p>

      <div className="mt-4">
        {cameraActive ? (
          <>
            <BarcodeScanner active={cameraActive} onDetected={(upc) => void runScan(upc)} />
            <button
              type="button"
              onClick={() => setCameraActive(false)}
              className="mt-2 w-full rounded-full py-2.5 text-sm font-semibold"
              style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}
            >
              Stop scanning
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setOutcome(null);
              setError(null);
              setCameraActive(true);
            }}
            className="w-full rounded-full py-3 text-sm font-bold text-white"
            style={{ background: "var(--color-primary)" }}
          >
            Scan a barcode
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runScan(manualUpc);
        }}
        className="mt-3 flex gap-2"
      >
        <label htmlFor="manual-upc" className="sr-only">
          Enter a barcode number
        </label>
        <input
          id="manual-upc"
          inputMode="numeric"
          value={manualUpc}
          onChange={(e) => setManualUpc(e.target.value)}
          placeholder="Or type the barcode number"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-base"
          style={{ borderColor: "var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)" }}
        />
        <button
          type="submit"
          disabled={busy || !manualUpc.trim()}
          className="rounded-full px-4 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          {busy ? "…" : "Check"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-destructive)" }}>
          {error}
        </p>
      )}

      {outcome && <ScanOutcomeCard outcome={outcome} />}

      <h2 className="mb-2 mt-8 text-sm font-black" style={{ color: "var(--color-foreground)" }}>
        Your pantry
      </h2>
      {pantry === undefined ? (
        <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          Loading…
        </p>
      ) : pantry.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          Nothing scanned yet. Items you scan are saved here and rechecked automatically as
          new recalls come in.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pantry.map((item) => (
            <li
              key={item._id}
              className="flex items-center gap-3 rounded-(--radius-base) p-3"
              style={{
                background: "var(--color-card)",
                border: item.matched ? "1px solid var(--color-destructive)" : "1px solid var(--color-border)",
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" style={{ color: "var(--color-foreground)" }}>
                  {item.productName ?? item.upc}
                </p>
                <p className="truncate text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                  {item.brand ? `${item.brand} · ` : ""}
                  {item.upc} · scanned {formatRelativeTime(item.scannedAt)}
                </p>
                {item.matched && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {item.matchedRecalls.map((r) => (
                      <Link
                        key={r._id}
                        href={`/recalls/${r._id}`}
                        className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                        style={{ background: "var(--color-destructive)" }}
                      >
                        {item.confidence === "possible" ? "Possible match" : "Matches a recall"}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void removeItem({ itemId: item._id })}
                aria-label={`Remove ${item.productName ?? item.upc} from your pantry`}
                className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function ScanOutcomeCard({ outcome }: { outcome: ScanOutcome }) {
  const name = outcome.productName ?? "This barcode";

  if (outcome.status === "recall") {
    return (
      <div className="mt-3 rounded-(--radius-base) border p-3" style={{ borderColor: "var(--color-destructive)", background: "var(--color-card)" }}>
        <p className="text-sm font-bold" style={{ color: "var(--color-destructive)" }}>
          {name} matches an active recall
        </p>
        <RecallLinks recalls={outcome.matchedRecalls} />
      </div>
    );
  }

  if (outcome.status === "same_manufacturer") {
    return (
      <div className="mt-3 rounded-(--radius-base) border p-3" style={{ borderColor: "var(--color-accent-text)", background: "var(--color-card)" }}>
        <p className="text-sm font-bold" style={{ color: "var(--color-foreground)" }}>
          {outcome.productName ?? outcome.brand ?? "This barcode"}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          {sameManufacturerExplanation(outcome.matchedRecalls.map((r) => r.firm))}
        </p>
        <RecallLinks recalls={outcome.matchedRecalls} />
      </div>
    );
  }

  if (outcome.status === "archived_recall") {
    return (
      <div className="mt-3 rounded-(--radius-base) border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}>
        <p className="text-sm font-bold" style={{ color: "var(--color-foreground)" }}>
          {name} — resolved recall
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          {archivedRecallExplanation(outcome.resolvedYear)}
        </p>
        <RecallLinks recalls={outcome.matchedRecalls} />
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-(--radius-base) border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}>
      {(outcome.productName || outcome.brand) && (
        <p className="text-sm font-bold" style={{ color: "var(--color-foreground)" }}>
          {[outcome.productName, outcome.brand].filter(Boolean).join(" — ")}
        </p>
      )}
      <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
        {NO_KNOWN_RECALL_COPY}
      </p>
    </div>
  );
}

function RecallLinks({ recalls }: { recalls: Array<{ _id: Id<"recalls">; title: string; firm: string }> }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {recalls.map((r) => (
        <li key={r._id}>
          <Link href={`/recalls/${r._id}`} className="text-sm font-semibold underline" style={{ color: "var(--color-primary-text)" }}>
            {r.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-16 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
      {children}
    </p>
  );
}

function Prompt({ title, body, cta, href }: { title: string; body: string; cta: string; href: string }) {
  return (
    <main className="px-6 py-16 text-center">
      <h1 className="text-2xl font-black" style={{ color: "var(--color-foreground)" }}>{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: "var(--color-muted-foreground)" }}>{body}</p>
      <Link
        href={href}
        className="mt-6 inline-block min-h-[44px] rounded-full px-6 py-3 text-sm font-bold text-white"
        style={{ background: "var(--color-primary)" }}
      >
        {cta}
      </Link>
    </main>
  );
}
