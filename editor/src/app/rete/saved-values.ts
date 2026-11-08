// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/saved-values.ts
//
// Where the credential and preset fields keep their named values. Normally the backend's store
// (admin-api-client.ts, ~/.thingstudio/credentials and presets). In the online demo (__DEMO__,
// docs/working-notes/online-editor-demo-scoping.md, code item 7) there is no backend: values live in this
// page's memory and are gone on reload. Nothing is written to localStorage or sent anywhere.
//
// One module, so the fields (CredentialRefField.vue, ConfigRefField.vue, PresetRefField.vue) and main.ts's
// credential resolve never import the admin-API client themselves: the demo bundle then doesn't contain it.
// Each function picks its side with a `__DEMO__ ? ... : ...` on a compile-time constant, which the bundler
// folds, so the backend branch is gone from the demo build and the memory branch from the normal one.

import { backendWsUrl } from "./store";
import { AdminApiError, getCredential as apiGetCredential, getPreset as apiGetPreset, listCredentials as apiListCredentials, listPresets as apiListPresets, putCredential as apiPutCredential, putPreset as apiPutPreset } from "../../flow-file/admin-api-client";
import type { CredentialType, PresetInfo } from "../../flow-file/admin-api-client";

export type { CredentialType, PresetInfo };

/** The note the demo shows on every credential field. */
export const DEMO_CREDENTIAL_NOTE = "Demo: nothing is saved or sent. Use made-up values.";

/** A named value that isn't saved (the backend's 404, or not in the demo's memory). */
export class SavedValueMissing extends Error {}

const memory = new Map<string, Record<string, unknown>>();
const memoryKey = (kind: string, type: string, name: string): string => `${kind}\u0000${type}\u0000${name}`;
const memoryNames = (kind: string, type: string): string[] => {
  const prefix = `${kind}\u0000${type}\u0000`;
  return [...memory.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort();
};
function memoryGet(kind: string, type: string, name: string): Record<string, unknown> {
  const value = memory.get(memoryKey(kind, type, name));
  if (!value) throw new SavedValueMissing(`no ${type} ${kind} called "${name}" in this demo yet`);
  return { ...value };
}
async function memoryPut(kind: string, type: string, name: string, data: Record<string, unknown>): Promise<void> {
  memory.set(memoryKey(kind, type, name), { ...data });
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
