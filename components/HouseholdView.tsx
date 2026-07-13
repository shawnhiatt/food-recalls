"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import {
  AGE_BAND_LABEL,
  PRESET_LABEL,
  formatAllergenLabel,
  type AgeBand,
  type NotificationPreset,
} from "@/lib/copy";
import { STATE_NAME } from "@/lib/states";
import { PushNotificationSetup } from "@/components/PushNotificationSetup";

// The established-household view (SPEC.md §11 Step 5 recap + §12 fully-editable
// Household tab). Demographic fields (states, people, allergens, pets) are
// edited holistically via "Redo setup" (prefilled); the notification knobs,
// category gates, brand/keyword matches, invitations, and account controls are
// edited inline here.
export function HouseholdView() {
  const summary = useQuery(api.household.getMySummary, {});
  const settings = useQuery(api.household.getMyNotificationSettings, {});

  if (summary === undefined) return <Centered>Loading…</Centered>;
  if (summary === null) return <Centered>No household found.</Centered>;

  return (
    <main className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black" style={{ color: "var(--color-foreground)" }}>
            {summary.householdName}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
            {summary.summary}
          </p>
        </div>
        <Link
          href="/household/setup"
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
          style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}
        >
          Redo setup
        </Link>
      </div>

      <Section title="Location">
        <p className="text-sm" style={{ color: "var(--color-foreground)" }}>
          {summary.states.length > 0
            ? summary.states.map((s) => STATE_NAME[s] ?? s).join(", ")
            : "No state set"}
        </p>
        {summary.chains.length > 0 && (
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
            Stores: {summary.chains.join(", ")}
          </p>
        )}
      </Section>

      {summary.allergens.length > 0 && (
        <Section title="Allergens">
          <ChipList items={summary.allergens.map(formatAllergenLabel)} />
        </Section>
      )}

      <Section title="Household members">
        <ul className="flex flex-col gap-1.5">
          {summary.members.map((m, i) => (
            <li key={i} className="text-sm" style={{ color: "var(--color-foreground)" }}>
              {m.label}
              {m.labelPinned && ` · ${AGE_BAND_LABEL[m.ageBand as AgeBand]}`}
              {m.pregnant && " · Pregnant"}
              {m.immunocompromised && " · Weakened immune system"}
            </li>
          ))}
        </ul>
      </Section>

      {summary.pets.length > 0 && (
        <Section title="Pets">
          <p className="text-sm capitalize" style={{ color: "var(--color-foreground)" }}>
            {summary.pets.join(", ")}
          </p>
        </Section>
      )}

      <Section title="What to watch">
        <CategoryToggles categories={summary.categories} />
      </Section>

      <Section title="Brands & keywords you follow">
        <StringListEditor
          label="Brands"
          values={summary.brands}
          onSave={(brands) => ({ brands })}
        />
        <StringListEditor
          label="Keywords"
          values={summary.keywords}
          onSave={(keywords) => ({ keywords })}
        />
      </Section>

      <Section title="Notifications">
        <NotificationSettings settings={settings} preset={summary.preset} />
        <PushNotificationSetup initialEnabled={summary.pushEnabled} preset={summary.preset} />
      </Section>

      {summary.role === "owner" && <InvitesSection />}

      <AccountSection role={summary.role} />
    </main>
  );
}

function CategoryToggles({ categories }: { categories: { humanFood: boolean; petFood: boolean; outbreaks: boolean } }) {
  const update = useMutation(api.household.updatePreferences);
  const rows: Array<{ key: keyof typeof categories; label: string }> = [
    { key: "humanFood", label: "Human food recalls" },
    { key: "petFood", label: "Pet food recalls" },
    { key: "outbreaks", label: "Outbreak alerts" },
  ];
  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ key, label }) => (
        <Toggle
          key={key}
          label={label}
          checked={categories[key]}
          onChange={(v) => update({ categories: { ...categories, [key]: v } })}
        />
      ))}
      <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
        Turning a category off silences it completely — even urgent alerts.
      </p>
    </div>
  );
}

function NotificationSettings({
  settings,
  preset,
}: {
  settings: { emailOptIn: boolean } | null | undefined;
  preset: NotificationPreset;
}) {
  const update = useMutation(api.household.updateNotificationSettings);
  const presets: NotificationPreset[] = ["recommended", "everything", "digest_only"];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === preset}
            onClick={() => update({ preset: p })}
            className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={{ background: p === preset ? "var(--color-primary)" : "var(--color-secondary)", color: p === preset ? "#fff" : "var(--color-foreground)" }}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      {settings && (
        <Toggle
          label="Email alerts"
          checked={settings.emailOptIn}
          onChange={(v) => update({ emailOptIn: v })}
        />
      )}
    </div>
  );
}

function StringListEditor({
  label,
  values,
  onSave,
}: {
  label: string;
  values: string[];
  onSave: (next: string[]) => Record<string, string[]>;
}) {
  const update = useMutation(api.household.updatePreferences);
  const [draft, setDraft] = useState("");

  function add(e: React.FormEvent) {
    e.preventDefault();
    const v = draft.trim();
    if (!v || values.some((x) => x.toLowerCase() === v.toLowerCase())) { setDraft(""); return; }
    update(onSave([...values, v]));
    setDraft("");
  }

  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-semibold" style={{ color: "var(--color-muted-foreground)" }}>{label}</p>
      {values.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <li key={v}>
              <button
                type="button"
                onClick={() => update(onSave(values.filter((x) => x !== v)))}
                className="rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
                aria-label={`Remove ${v}`}
              >
                {v} ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add a ${label.toLowerCase().replace(/s$/, "")}`}
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)" }}
        />
        <button type="submit" className="rounded-full px-3 text-xs font-semibold" style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}>
          Add
        </button>
      </form>
    </div>
  );
}

function InvitesSection() {
  const invites = useQuery(api.invites.listInvites, {});
  const members = useQuery(api.household.listMembers, {});
  const createInvite = useMutation(api.invites.createInvite);
  const revokeInvite = useMutation(api.invites.revokeInvite);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createInvite({ email, role: "member" });
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Household members & invites">
      {members && (
        <ul className="mb-3 flex flex-col gap-1">
          {members.map((m) => (
            <li key={m.email} className="flex items-center justify-between text-sm" style={{ color: "var(--color-foreground)" }}>
              <span>{m.email}{m.isSelf ? " (you)" : ""}</span>
              <span className="text-xs capitalize" style={{ color: "var(--color-muted-foreground)" }}>{m.role}</span>
            </li>
          ))}
        </ul>
      )}

      {invites && invites.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1">
          {invites.map((inv) => (
            <li key={inv.token} className="flex items-center justify-between text-sm" style={{ color: "var(--color-muted-foreground)" }}>
              <span>{inv.email} — invited</span>
              <button
                type="button"
                onClick={() => revokeInvite({ token: inv.token })}
                className="text-xs font-semibold underline"
                style={{ color: "var(--color-destructive)" }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={invite} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Invite by email"
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)" }}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-full px-3 text-xs font-bold text-white disabled:opacity-60"
          style={{ background: "var(--color-primary)" }}
        >
          {busy ? "…" : "Invite"}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs" style={{ color: "var(--color-destructive)" }}>{error}</p>}
    </Section>
  );
}

function AccountSection({ role }: { role: "owner" | "member" }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const exportData = useQuery(api.household.exportData, {});
  const deleteAccount = useMutation(api.household.deleteAccount);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  function download() {
    if (!exportData) return;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "food-recalls-data.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await deleteAccount({});
      await signOut();
      router.replace("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Your account">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={download}
          disabled={!exportData}
          className="w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}
        >
          Download my data
        </button>
        <button
          type="button"
          onClick={async () => { await signOut(); router.replace("/"); }}
          className="w-full rounded-full py-2.5 text-sm font-semibold"
          style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}
        >
          Sign out
        </button>

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-full rounded-full py-2.5 text-sm font-semibold"
            style={{ color: "var(--color-destructive)" }}
          >
            Delete my account
          </button>
        ) : (
          <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-destructive)" }}>
            <p className="text-sm" style={{ color: "var(--color-foreground)" }}>
              {role === "owner"
                ? "This deletes your account. If you're the last member, your household and its preferences are deleted too. This can't be undone."
                : "This removes you from the household and deletes your account. This can't be undone."}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={confirmDelete}
                disabled={busy}
                className="flex-1 rounded-full py-2 text-sm font-bold text-white disabled:opacity-60"
                style={{ background: "var(--color-destructive)" }}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-full py-2 text-sm font-semibold"
                style={{ background: "var(--color-secondary)", color: "var(--color-primary-text)" }}
              >
                Keep my account
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

// --- shared bits ---------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--color-foreground)" }}>{title}</h2>
      {children}
    </div>
  );
}

function ChipList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-full px-2.5 py-1 text-xs font-medium capitalize"
          style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
        >
          {item}
        </li>
      ))}
    </ul>
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
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: checked ? "1.25rem" : "0.125rem" }} />
      </button>
    </label>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-16 text-center text-sm" style={{ color: "var(--color-muted-foreground)" }}>
      {children}
    </p>
  );
}
