// Types for scripts/fda-relay.mjs (plain JS so Node runs it with no build step).
export declare const RSS_URL: string;

export type RelaySummary =
  | { ok: false; error: string; state: string }
  | {
      ok: true;
      state: string;
      feedItems: number;
      newPages: number;
      recorded: number;
      recallsEnriched: number;
      failedPages: string[];
    };

export declare function runRelay(options: {
  relayUrl: string;
  secret: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
  pauseMs?: number;
}): Promise<RelaySummary>;
