/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapters_fsis from "../adapters/fsis.js";
import type * as adapters_openfda from "../adapters/openfda.js";
import type * as adapters_types from "../adapters/types.js";
import type * as audit from "../audit.js";
import type * as bookmarks from "../bookmarks.js";
import type * as crons from "../crons.js";
import type * as household from "../household.js";
import type * as ingest_fsis from "../ingest/fsis.js";
import type * as ingest_lib from "../ingest/lib.js";
import type * as ingest_openfda from "../ingest/openfda.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_contentHash from "../lib/contentHash.js";
import type * as lib_digest from "../lib/digest.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_enrichment from "../lib/enrichment.js";
import type * as lib_lifecycle from "../lib/lifecycle.js";
import type * as lib_matching from "../lib/matching.js";
import type * as lib_states from "../lib/states.js";
import type * as lib_summary from "../lib/summary.js";
import type * as notifications from "../notifications.js";
import type * as recalls from "../recalls.js";
import type * as seed from "../seed.js";
import type * as sourceHealth from "../sourceHealth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "adapters/fsis": typeof adapters_fsis;
  "adapters/openfda": typeof adapters_openfda;
  "adapters/types": typeof adapters_types;
  audit: typeof audit;
  bookmarks: typeof bookmarks;
  crons: typeof crons;
  household: typeof household;
  "ingest/fsis": typeof ingest_fsis;
  "ingest/lib": typeof ingest_lib;
  "ingest/openfda": typeof ingest_openfda;
  "lib/access": typeof lib_access;
  "lib/contentHash": typeof lib_contentHash;
  "lib/digest": typeof lib_digest;
  "lib/email": typeof lib_email;
  "lib/enrichment": typeof lib_enrichment;
  "lib/lifecycle": typeof lib_lifecycle;
  "lib/matching": typeof lib_matching;
  "lib/states": typeof lib_states;
  "lib/summary": typeof lib_summary;
  notifications: typeof notifications;
  recalls: typeof recalls;
  seed: typeof seed;
  sourceHealth: typeof sourceHealth;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
