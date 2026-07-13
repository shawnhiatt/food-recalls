"use client";

import { useMemo, useState } from "react";
import {
  AGE_BAND_LABEL,
  BIG_NINE_ALLERGENS,
  PRESET_LABEL,
  formatAllergenLabel,
  type AgeBand,
  type NotificationPreset,
} from "@/lib/copy";
import { US_STATES, STATE_NAME } from "@/lib/states";

// §11 onboarding questionnaire, reused for first-run (/onboarding) and "Redo
// setup" (Household tab). Five steps; Step 1 (location) is the only required
// one, everything else is skippable and editable later. Member behaviour
// follows §11: labels derive from the age band until manually renamed (then
// pin), the Pregnant toggle only renders for adult / 65+, and the privacy note
// appears only once a health flag is switched on.

type Pet = "dog" | "cat" | "other";

export type MemberDraft = {
  ageBand: AgeBand;
  pregnant?: boolean;
  immunocompromised?: boolean;
  customLabel?: string; // set => manual rename => pinned
};

export type WizardAnswers = {
  householdName: string;
  location: { states: string[]; stores: string[] };
  people: { members: MemberDraft[]; pets: Pet[] };
  allergens: string[];
  notifications: { preset: NotificationPreset; timezone: string };
  brands: string[];
  keywords: string[];
};

/** Mirror of convex deriveMemberLabels for live preview of default labels. */
function derivedLabel(members: MemberDraft[], index: number): string {
  const base = AGE_BAND_LABEL[members[index]!.ageBand];
  let count = 0;
  let ordinal = 0;
  members.forEach((m, i) => {
    if (m.customLabel) return;
    if (AGE_BAND_LABEL[m.ageBand] === base) {
      count++;
      if (i === index) ordinal = count;
    }
  });
  return count > 1 ? `${base} ${ordinal}` : base;
}

function displayLabel(members: MemberDraft[], index: number): string {
  return members[index]!.customLabel?.trim() || derivedLabel(members, index);
}

const PRESETS: NotificationPreset[] = ["recommended", "everything", "digest_only"];
const PRESET_HELP: Record<NotificationPreset, string> = {
  recommended: "Instant alerts only for urgent matches; everything else in a daily email.",
  everything: "Instant alerts the moment anything matches your household.",
  digest_only: "One daily email; instant alerts stay off except the most urgent.",
};

export function defaultAnswers(): WizardAnswers {
  const timezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
      : "America/New_York";
  return {
    householdName: "",
    location: { states: [], stores: [] },
    people: { members: [{ ageBand: "adult" }], pets: [] },
    allergens: [],
    notifications: { preset: "recommended", timezone },
    brands: [],
    keywords: [],
  };
}

export function OnboardingWizard({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: WizardAnswers;
  submitLabel: string;
  onSubmit: (answers: WizardAnswers) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial ?? defaultAnswers());
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = ["Where", "Who", "Allergens", "Alerts", "Review"];
  const canAdvance = step !== 0 || answers.location.states.length > 0;

  function patch(p: Partial<WizardAnswers>) {
    setAnswers((a) => ({ ...a, ...p }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="px-4 py-6">
      <ol className="mb-5 flex items-center gap-1.5" aria-label="Progress">
        {steps.map((label, i) => (
          <li key={label} className="flex-1">
            <div
              className="h-1.5 rounded-full"
              style={{ background: i <= step ? "var(--color-primary)" : "var(--color-border)" }}
            />
            <span className="sr-only">
              {label}
              {i === step ? " (current)" : ""}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && <StepWhere answers={answers} patch={patch} />}
      {step === 1 && <StepWho answers={answers} patch={patch} />}
      {step === 2 && <StepAllergens answers={answers} patch={patch} />}
      {step === 3 && <StepAlerts answers={answers} patch={patch} />}
      {step === 4 && <StepReview answers={answers} />}

      {error && (
        <p role="alert" className="mt-4 text-sm" style={{ color: "var(--color-destructive)" }}>
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold"
            style={{ color: "var(--color-primary-text)" }}
          >
            Back
          </button>
        ) : (
          <span />
        )}
        {step < steps.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance}
            className="min-h-[44px] rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: "var(--color-primary)" }}
          >
            {step === 0 && !canAdvance ? "Add a state to continue" : "Next"}
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="min-h-[44px] rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-60"
            style={{ background: "var(--color-primary)" }}
          >
            {busy ? "Saving…" : submitLabel}
          </button>
        )}
      </div>
    </main>
  );
}

type StepProps = { answers: WizardAnswers; patch: (p: Partial<WizardAnswers>) => void };

function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-xl font-black" style={{ color: "var(--color-foreground)" }}>
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          {subtitle}
        </p>
      )}
    </header>
  );
}

function StepWhere({ answers, patch }: StepProps) {
  const selected = answers.location.states;
  const available = US_STATES.filter((s) => !selected.includes(s.code));
  const [store, setStore] = useState("");

  return (
    <section>
      <StepHeading title="Where you are" subtitle="We use this to match recalls to your state. Your first state is primary." />
      <label className="block text-sm font-semibold" htmlFor="household-name" style={{ color: "var(--color-foreground)" }}>
        Household name
      </label>
      <input
        id="household-name"
        value={answers.householdName}
        onChange={(e) => patch({ householdName: e.target.value })}
        placeholder="e.g. The Rivera household"
        className="mt-1.5 mb-5 w-full rounded-lg border px-3 py-2.5 text-base"
        style={{ borderColor: "var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)" }}
      />
      <label className="text-sm font-semibold" htmlFor="add-state" style={{ color: "var(--color-foreground)" }}>
        Your state(s)
      </label>
      <select
        id="add-state"
        value=""
        onChange={(e) => {
          if (e.target.value) patch({ location: { ...answers.location, states: [...selected, e.target.value] } });
        }}
        className="mt-1.5 w-full rounded-lg border px-3 py-2.5 text-base"
        style={{ borderColor: "var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)" }}
      >
        <option value="">Add a state…</option>
        {available.map((s) => (
          <option key={s.code} value={s.code}>{s.name}</option>
        ))}
      </select>

      {selected.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {selected.map((code, i) => (
            <li key={code}>
              <button
                type="button"
                onClick={() => patch({ location: { ...answers.location, states: selected.filter((c) => c !== code) } })}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
                aria-label={`Remove ${STATE_NAME[code] ?? code}`}
              >
                {STATE_NAME[code] ?? code}{i === 0 ? " (primary)" : ""} ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="mt-6 block text-sm font-semibold" htmlFor="add-store" style={{ color: "var(--color-foreground)" }}>
        Favorite stores <span className="font-normal" style={{ color: "var(--color-muted-foreground)" }}>(optional)</span>
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = store.trim();
          if (v) { patch({ location: { ...answers.location, stores: [...answers.location.stores, v] } }); setStore(""); }
        }}
        className="mt-1.5 flex gap-2"
      >
        <input
          id="add-store"
          value={store}
          onChange={(e) => setStore(e.target.value)}
          placeholder="e.g. Publix"
          className="flex-1 rounded-lg border px-3 py-2.5 text-base"
          style={{ borderColor: "var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)" }}
        />
        <button type="submit" className="rounded-full px-4 text-sm font-semibold" style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}>
          Add
        </button>
      </form>
      {answers.location.stores.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {answers.location.stores.map((s, i) => (
            <li key={`${s}-${i}`}>
              <button
                type="button"
                onClick={() => patch({ location: { ...answers.location, stores: answers.location.stores.filter((_, j) => j !== i) } })}
                className="rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
              >
                {s} ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const AGE_BANDS: AgeBand[] = ["infant", "child", "adult", "older_adult"];
const PETS: Pet[] = ["dog", "cat", "other"];

function StepWho({ answers, patch }: StepProps) {
  const members = answers.people.members;

  function setMember(i: number, m: MemberDraft) {
    patch({ people: { ...answers.people, members: members.map((x, j) => (j === i ? m : x)) } });
  }

  return (
    <section>
      <StepHeading title="Who's in your household" subtitle="Age bands only — no birthdays. This flags recalls that name at-risk groups." />

      <ul className="flex flex-col gap-3">
        {members.map((m, i) => {
          const showPregnant = m.ageBand === "adult" || m.ageBand === "older_adult";
          return (
            <li key={i} className="rounded-xl border p-3" style={{ borderColor: "var(--color-border)" }}>
              <div className="flex items-center justify-between gap-2">
                <input
                  value={m.customLabel ?? displayLabel(members, i)}
                  onChange={(e) => setMember(i, { ...m, customLabel: e.target.value })}
                  aria-label={`Member ${i + 1} label`}
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none"
                  style={{ color: "var(--color-foreground)" }}
                />
                {members.length > 1 && (
                  <button
                    type="button"
                    onClick={() => patch({ people: { ...answers.people, members: members.filter((_, j) => j !== i) } })}
                    className="shrink-0 text-xs font-semibold"
                    style={{ color: "var(--color-destructive)" }}
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {AGE_BANDS.map((band) => (
                  <button
                    key={band}
                    type="button"
                    onClick={() => setMember(i, { ...m, ageBand: band, pregnant: band === "adult" || band === "older_adult" ? m.pregnant : undefined })}
                    aria-pressed={m.ageBand === band}
                    className="rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{
                      background: m.ageBand === band ? "var(--color-primary)" : "var(--color-secondary)",
                      color: m.ageBand === band ? "#fff" : "var(--color-foreground)",
                    }}
                  >
                    {AGE_BAND_LABEL[band]}
                  </button>
                ))}
              </div>

              <div className="mt-2.5 flex flex-col gap-1.5">
                {showPregnant && (
                  <Toggle
                    label="Pregnant"
                    checked={!!m.pregnant}
                    onChange={(v) => setMember(i, { ...m, pregnant: v })}
                  />
                )}
                <Toggle
                  label="Weakened immune system"
                  checked={!!m.immunocompromised}
                  onChange={(v) => setMember(i, { ...m, immunocompromised: v })}
                />
              </div>

              {(m.pregnant || m.immunocompromised) && (
                <p className="mt-2 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                  Used only to flag recalls that name at-risk groups. Never shown in
                  notifications. Removable anytime.
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => patch({ people: { ...answers.people, members: [...members, { ageBand: "adult" }] } })}
        className="mt-3 rounded-full px-4 py-2 text-sm font-semibold"
        style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}
      >
        + Add a person
      </button>

      <h2 className="mt-6 text-sm font-bold" style={{ color: "var(--color-foreground)" }}>Pets</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PETS.map((pet) => {
          const on = answers.people.pets.includes(pet);
          return (
            <button
              key={pet}
              type="button"
              aria-pressed={on}
              onClick={() =>
                patch({
                  people: {
                    ...answers.people,
                    pets: on ? answers.people.pets.filter((p) => p !== pet) : [...answers.people.pets, pet],
                  },
                })
              }
              className="rounded-full px-3 py-1.5 text-sm font-medium capitalize"
              style={{ background: on ? "var(--color-primary)" : "var(--color-secondary)", color: on ? "#fff" : "var(--color-foreground)" }}
            >
              {pet}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StepAllergens({ answers, patch }: StepProps) {
  return (
    <section>
      <StepHeading title="Allergens" subtitle="We'll flag recalls that involve any allergen you pick." />
      <div className="flex flex-wrap gap-1.5">
        {BIG_NINE_ALLERGENS.map((a) => {
          const on = answers.allergens.includes(a);
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              onClick={() => patch({ allergens: on ? answers.allergens.filter((x) => x !== a) : [...answers.allergens, a] })}
              className="rounded-full px-3 py-1.5 text-sm font-medium capitalize"
              style={{ background: on ? "var(--color-primary)" : "var(--color-secondary)", color: on ? "#fff" : "var(--color-foreground)" }}
            >
              {formatAllergenLabel(a)}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
        Used only to flag recalls containing these allergens. Never shown in notifications.
        Removable anytime.
      </p>
    </section>
  );
}

function StepAlerts({ answers, patch }: StepProps) {
  return (
    <section>
      <StepHeading title="How you want to hear about it" subtitle="You can turn on push alerts from your Household tab once setup is done." />
      <div className="flex flex-col gap-2">
        {PRESETS.map((preset) => {
          const on = answers.notifications.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={on}
              onClick={() => patch({ notifications: { ...answers.notifications, preset } })}
              className="rounded-xl border p-3 text-left"
              style={{
                borderColor: on ? "var(--color-primary)" : "var(--color-border)",
                background: on ? "var(--color-secondary)" : "var(--color-card)",
              }}
            >
              <span className="text-sm font-bold" style={{ color: "var(--color-foreground)" }}>
                {PRESET_LABEL[preset]}
                {preset === "recommended" && " · Recommended"}
              </span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                {PRESET_HELP[preset]}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StepReview({ answers }: { answers: WizardAnswers }) {
  const recap = useMemo(() => {
    const parts: string[] = [];
    if (answers.location.states.length) parts.push(`Recalls in ${answers.location.states.join(", ")}`);
    if (answers.allergens.length) parts.push(`${answers.allergens.map(formatAllergenLabel).join(" & ")} allergens`);
    const counts = new Map<AgeBand, number>();
    answers.people.members.forEach((m) => counts.set(m.ageBand, (counts.get(m.ageBand) ?? 0) + 1));
    counts.forEach((n, band) => parts.push(`${n} ${AGE_BAND_LABEL[band].toLowerCase()}${n > 1 ? "s" : ""}`));
    if (answers.people.pets.length) parts.push(answers.people.pets.join(" & "));
    parts.push(PRESET_LABEL[answers.notifications.preset]);
    return parts.join(" · ");
  }, [answers]);

  return (
    <section>
      <StepHeading title="What counts as relevant to your household" />
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-secondary)" }}>
        <p className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>{recap}</p>
      </div>
      <p className="mt-3 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
        You can change any of this later from the Household tab.
      </p>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm" style={{ color: "var(--color-foreground)" }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-10 shrink-0 rounded-full transition-colors"
        style={{ background: checked ? "var(--color-primary)" : "var(--color-border)" }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
          style={{ left: checked ? "1.25rem" : "0.125rem" }}
        />
      </button>
    </label>
  );
}

/** Convert wizard answers into the completeOnboarding / redoSetup argument. */
export function toQuestionnaire(answers: WizardAnswers) {
  return {
    householdName: answers.householdName.trim() || "My household",
    location: answers.location,
    people: {
      members: answers.people.members.map((m) => ({
        label: m.customLabel?.trim() ? m.customLabel.trim() : undefined,
        ageBand: m.ageBand,
        pregnant: m.pregnant,
        immunocompromised: m.immunocompromised,
      })),
      pets: answers.people.pets,
    },
    allergens: answers.allergens,
    notifications: answers.notifications,
    brands: answers.brands,
    keywords: answers.keywords,
  };
}
