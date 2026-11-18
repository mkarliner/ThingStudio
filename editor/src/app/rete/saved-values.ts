// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/saved-values.ts
//
// Where the credential and preset fields keep their named values. Normally the backend's store
// (admin-api-client.ts, ~/.thingstudio/credentials and presets). Online (__DEMO__) there is no backend: values
// live in this browser tab's sessionStorage, so they survive a reload and are gone when the tab closes; each tab
// has its own (Mike, 2026-11-18: "only for a session, not persistent"; online-editor-webserial-briefing.md, B).
// File → Forget WiFi and broker details clears them sooner. Nothing is sent anywhere. Where sessionStorage can't
// be used (some private modes), they live in page memory, as the demo's did.
//
// One module, so the fields (CredentialRefField.vue, ConfigRefField.vue, PresetRefField.vue) and main.ts's
// credential resolve never import the admin-API client themselves: the demo bundle then doesn't contain it.
// Each function picks its side with a `__DEMO__ ? ... : ...` on a compile-time constant, which the bundler
// folds, so the backend branch is gone from the demo build and the memory branch from the normal one.

import { backendWsUrl } from "./store";
import { AdminApiError, getCredential as apiGetCredential, getPreset as apiGetPreset, listCredentials as apiListCredentials, listPresets as apiListPresets, putCredential as apiPutCredential, putPreset as apiPutPreset } from "../../flow-file/admin-api-client";
import type { CredentialType, PresetInfo } from "../../flow-file/admin-api-client";

export type { CredentialType, PresetInfo };

/** The note the online editor shows on every credential field. */
export const DEMO_CREDENTIAL_NOTE = "Kept in this browser tab until you close it, and sent nowhere. File → Forget WiFi and broker details clears it now.";

/** A named value that isn't saved (the backend's 404, or not in the demo's memory). */
export class SavedValueMissing extends Error {}

/** One store for the tab: sessionStorage under one key, or page memory where that throws. */
const STORE_KEY = "thingstudio.savedValues";
const fallback = new Map<string, Record<string, unknown>>();

function readAll(): Map<string, Record<string, unknown>> {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw === null) return new Map(fallback);
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map(fallback);
  }
}

function writeAll(values: Map<string, Record<string, unknown>>): void {
  fallback.clear();
  for (const [k, v] of values) fallback.set(k, v);
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(values)));
  } catch {
    // No sessionStorage here: page memory (fallback) holds them until reload.
  }
}

const memoryKey = (kind: string, type: string, name: string): string => `${kind}\u0000${type}\u0000${name}`;
const memoryNames = (kind: string, type: string): string[] => {
  const prefix = `${kind}\u0000${type}\u0000`;
  return [...readAll().keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort();
};
function memoryGet(kind: string, type: string, name: string): Record<string, unknown> {
  const value = readAll().get(memoryKey(kind, type, name));
  if (!value) throw new SavedValueMissing(`no ${type} ${kind} called "${name}" in this browser tab yet`);
  return { ...value };
}
async function memoryPut(kind: string, type: string, name: string, data: Record<string, unknown>): Promise<void> {
  const all = readAll();
  all.set(memoryKey(kind, type, name), { ...data });
  writeAll(all);
}

/** Online only: forgets every saved credential and preset in this tab. Returns how many there were. */
export function forgetSavedValues(): number {
  const count = readAll().size;
  writeAll(new Map());
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    // nothing stored there
  }
  return count;
}

/** Online only: true when this tab already holds a value under this name (so an example doesn't overwrite it). */
export function hasSavedCredential(type: CredentialType, name: string): boolean {
  return readAll().has(memoryKey("credential", type, name));
}

export async function listCredentials(type: CredentialType): Promise<string[]> {
  return __DEMO__ ? memoryNames("credential", type) : apiListCredentials(backendWsUrl.value, type);
}

export async function getCredential(type: CredentialType, name: string): Promise<Record<string, unknown>> {
  return __DEMO__ ? memoryGet("credential", type, name) : apiGetCredential(backendWsUrl.value, type, name);
}

export async function putCredential(type: CredentialType, name: string, data: Record<string, unknown>): Promise<void> {
  return __DEMO__ ? memoryPut("credential", type, name, data) : apiPutCredential(backendWsUrl.value, type, name, data);
}

export async function listPresets(presetType: string): Promise<PresetInfo[]> {
  return __DEMO__
    ? memoryNames("preset", presetType).map((name) => ({ name, valid: true, error: null }))
    : apiListPresets(backendWsUrl.value, presetType);
}

export async function getPreset(presetType: string, name: string): Promise<Record<string, unknown>> {
  return __DEMO__ ? memoryGet("preset", presetType, name) : apiGetPreset(backendWsUrl.value, presetType, name);
}

export async function putPreset(presetType: string, name: string, data: Record<string, unknown>): Promise<void> {
  return __DEMO__ ? memoryPut("preset", presetType, name, data) : apiPutPreset(backendWsUrl.value, presetType, name, data);
}

/** True when `err` says the named value isn't saved, as opposed to the store being unreachable. */
export function isMissing(err: unknown): boolean {
  return err instanceof SavedValueMissing || (!__DEMO__ && err instanceof AdminApiError && err.status === 404);
}

/** The text to show for a failed load or save. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The tab store itself, for tests: the build fixes `__DEMO__`, so the exported functions above always take the
 * backend side under vitest. */
export const tabStoreForTests = { names: memoryNames, get: memoryGet, put: memoryPut };
