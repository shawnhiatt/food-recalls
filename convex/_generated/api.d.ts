/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as adapters_fsis from "../adapters/fsis.js";
import type * as adapters_openfda from "../adapters/openfda.js";
import type * as adapters_types from "../adapters/types.js";
import type * as crons from "../crons.js";
import type * as ingest_fsis from "../ingest/fsis.js";
import type * as ingest_lib from "../ingest/lib.js";
import type * as ingest_openfda from "../ingest/openfda.js";
import type * as lib_contentHash from "../lib/contentHash.js";
import type * as lib_enrichment from "../lib/enrichment.js";
import type * as lib_lifecycle from "../lib/lifecycle.js";
import type * as lib_states from "../lib/states.js";
import type * as lib_summary from "../lib/summary.js";
import type * as recalls from "../recalls.js";
import type * as seed from "../seed.js";
import type * as sourceHealth from "../sourceHealth.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  "adapters/fsis": typeof adapters_fsis;
  "adapters/openfda": typeof adapters_openfda;
  "adapters/types": typeof adapters_types;
  crons: typeof crons;
  "ingest/fsis": typeof ingest_fsis;
  "ingest/lib": typeof ingest_lib;
  "ingest/openfda": typeof ingest_openfda;
  "lib/contentHash": typeof lib_contentHash;
  "lib/enrichment": typeof lib_enrichment;
  "lib/lifecycle": typeof lib_lifecycle;
  "lib/states": typeof lib_states;
  "lib/summary": typeof lib_summary;
  recalls: typeof recalls;
  seed: typeof seed;
  sourceHealth: typeof sourceHealth;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
