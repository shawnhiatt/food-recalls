/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ResendOTP from "../ResendOTP.js";
import type * as adapters_cdc from "../adapters/cdc.js";
import type * as adapters_fdaRss from "../adapters/fdaRss.js";
import type * as adapters_fsis from "../adapters/fsis.js";
import type * as adapters_openfda from "../adapters/openfda.js";
import type * as adapters_types from "../adapters/types.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as bookmarks from "../bookmarks.js";
import type * as crons from "../crons.js";
import type * as feed from "../feed.js";
import type * as household from "../household.js";
import type * as http from "../http.js";
import type * as ingest_cdc from "../ingest/cdc.js";
import type * as ingest_fdaRss from "../ingest/fdaRss.js";
import type * as ingest_fsis from "../ingest/fsis.js";
import type * as ingest_lib from "../ingest/lib.js";
import type * as ingest_openfda from "../ingest/openfda.js";
import type * as invites from "../invites.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_contentHash from "../lib/contentHash.js";
import type * as lib_digest from "../lib/digest.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_enrichment from "../lib/enrichment.js";
import type * as lib_lifecycle from "../lib/lifecycle.js";
import type * as lib_matching from "../lib/matching.js";
import type * as lib_members from "../lib/members.js";
import type * as lib_onboarding from "../lib/onboarding.js";
import type * as lib_pantry from "../lib/pantry.js";
import type * as lib_push from "../lib/push.js";
import type * as lib_states from "../lib/states.js";
import type * as lib_summary from "../lib/summary.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as outbreaks from "../outbreaks.js";
import type * as pantry from "../pantry.js";
import type * as press from "../press.js";
import type * as push from "../push.js";
import type * as pushSubscriptions from "../pushSubscriptions.js";
import type * as recalls from "../recalls.js";
import type * as seed from "../seed.js";
import type * as sourceHealth from "../sourceHealth.js";
import type * as unsubscribe from "../unsubscribe.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ResendOTP: typeof ResendOTP;
  "adapters/cdc": typeof adapters_cdc;
  "adapters/fdaRss": typeof adapters_fdaRss;
  "adapters/fsis": typeof adapters_fsis;
  "adapters/openfda": typeof adapters_openfda;
  "adapters/types": typeof adapters_types;
  audit: typeof audit;
  auth: typeof auth;
  bookmarks: typeof bookmarks;
  crons: typeof crons;
  feed: typeof feed;
  household: typeof household;
  http: typeof http;
  "ingest/cdc": typeof ingest_cdc;
  "ingest/fdaRss": typeof ingest_fdaRss;
  "ingest/fsis": typeof ingest_fsis;
  "ingest/lib": typeof ingest_lib;
  "ingest/openfda": typeof ingest_openfda;
  invites: typeof invites;
  "lib/auth": typeof lib_auth;
  "lib/contentHash": typeof lib_contentHash;
  "lib/digest": typeof lib_digest;
  "lib/email": typeof lib_email;
  "lib/enrichment": typeof lib_enrichment;
  "lib/lifecycle": typeof lib_lifecycle;
  "lib/matching": typeof lib_matching;
  "lib/members": typeof lib_members;
  "lib/onboarding": typeof lib_onboarding;
  "lib/pantry": typeof lib_pantry;
  "lib/push": typeof lib_push;
  "lib/states": typeof lib_states;
  "lib/summary": typeof lib_summary;
  migrations: typeof migrations;
  notifications: typeof notifications;
  outbreaks: typeof outbreaks;
  pantry: typeof pantry;
  press: typeof press;
  push: typeof push;
  pushSubscriptions: typeof pushSubscriptions;
  recalls: typeof recalls;
  seed: typeof seed;
  sourceHealth: typeof sourceHealth;
  unsubscribe: typeof unsubscribe;
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
