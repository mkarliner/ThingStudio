// SPDX-License-Identifier: Apache-2.0
// editor/src/flow-file/admin-api-client.ts
//
// The fetch-based half of the backend<->browser persisted-data protocol
// (docs/working-notes/outstanding-items/backend-persisted-data-protocol.md,
// [P1] -- shape decided 2026-09-07, no editor-side consumer built until
// now). Mirrors admin_api.py's route table 1:1: flow and custom-node-
// package CRUD against a running backend's `~/.thingstudio`
// (persisted_store.py). Same split file-io.ts/custom-node-io.ts already
// established for their own (File System Access) storage backends -- this
// module owns raw HTTP access only, not what a flow/custom-node package
// means (flow-file.ts / node-library/custom-node.ts still own parsing and
// validation on top of whatever text comes back from here).
//
// Storage is backend-exclusive as of 2026-09-08 (Mike's own call,
// confirmed before this module was built): every save/load in the editor
// goes through here now, not through file-io.ts/custom-node-io.ts's File
// System Access pickers -- those two modules stay in the tree (WebSerial
// "direct" mode is hidden, not deleted, per main.ts's own header comment)
// but main.ts no longer calls them. This is *why* the admin API needs no
// connection-mode branching of its own: it's reachable independent of
// whether a device transport is even open, which is exactly what made an
// HTTP admin API (rather than extending ws_relay.py's per-socket
// ConnectionSession) the right shape in the first place -- see the
// outstanding-item doc's "Two shapes" section.
//
// Reuses connModeSelect's `backendUrlInput` value (a ws:// URL, already
// the single field the WS transport needs) rather than adding a second
// "storage backend URL" input -- one backend location for the whole
// editor, matching Mike's "all file system ops go through backend" framing.
// backendHttpBaseUrl() below does the ws://->http:// translation every
// call site needs; nothing here assumes the WS transport is actually
// connected.
//
// CORS (backend/src/thingstudio_backend/cors.py, 2026-09-08): the backend
// reflects whatever Origin the request carries, so this works whether the
// editor and backend are same-origin (backend's own static_dir serving
// the built editor) or not (the `npm run dev` workflow; a remote/
// firewalled backend reached through an SSH/VPN tunnel per design doc §4's
// "browser somewhere else" framing --
// docs/working-notes/outstanding-items/posture-2-auth.md's 2026-09-08
// addendum covers the *other* shape, a backend binding to a non-loopback
// address directly, which is NOT what this module assumes).
//
// Error handling: every failure -- a network-level fetch() rejection
// (backend unreachable, CORS blocked, DNS failure) or a non-2xx HTTP
// response -- becomes an AdminApiError naming the operation and, for a
// network failure, the backend URL it couldn't reach, same
// naming-the-operation-and-host convention this project's other transport
// error paths already use (transport.ts, backend-transport.ts). A non-2xx
// response's `{"error": "NODE_ERROR: ..."}` body (admin_api.py's own
// error-response shape) is surfaced as-is rather than re-worded, so the
// backend's own structured message reaches the editor's console verbatim.

export const DEFAULT_BACKEND_WS_URL = "ws://127.0.0.1:8765/ws"; // matches __main__.py's --host 127.0.0.1 --port 8765 default and app.py's /ws route

export class AdminApiError extends Error {}

/** ws://host:port/ws -> http://host:port ; wss:// -> https://. The admin
 * API and the WS relay share one host:port (app.py wires both into the
 * same aiohttp Application), so this is a scheme swap plus stripping the
 * WS relay's own `/ws` path, not a second piece of user-facing config. */
export function backendHttpBaseUrl(wsUrl: string): string {
  let url: URL;
  try {
    url = new URL(wsUrl);
  } catch {
    throw new AdminApiError(`invalid backend URL "${wsUrl}" -- expected e.g. "${DEFAULT_BACKEND_WS_URL}"`);
  }
  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  else throw new AdminApiError(`backend URL "${wsUrl}" must start with "ws://" or "wss://"`);
  url.pathname = url.pathname.replace(/\/ws\/?$/, "");
  url.search = "";
  url.hash = "";
  const base = url.toString();
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

// Mirrors persisted_store.py's own _NAME_RE exactly (letters, digits, '_',
// '-', 1-100 characters) -- kept in sync by hand since the backend
// deliberately doesn't expose its validation regex over the wire; a name
// this produces is guaranteed to pass the backend's own check, so a
// PUT built from it never comes back a 400 for its name alone.
const MAX_NAME_LENGTH = 100;

/** Turns an arbitrary flow display name (flowNameInput's value, e.g. "My
 * Cool Flow", spaces and all) into a name valid as a backend storage key
 * and URL path segment. Deliberately a *different* string from the flow's
 * own `flowName` field inside the saved JSON (flow-file.ts) -- the display
 * name round-trips through the file's own content on open (main.ts's
 * applyFlowFile already restores flowNameInput from `file.flowName`, not
 * from whatever name it was opened under), so slugifying here loses
 * nothing the user actually sees. */
export function slugifyFlowName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug === "" ? "untitled" : slug).slice(0, MAX_NAME_LENGTH);
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body !== null && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    // Not JSON, or JSON without the expected shape -- fall through to the
    // generic status-line message below rather than throwing from inside
    // an error handler.
  }
  return `HTTP ${res.status} ${res.statusText}`;
}

async function request(wsUrl: string, path: string, init?: RequestInit): Promise<Response> {
  const base = backendHttpBaseUrl(wsUrl);
  try {
    return await fetch(`${base}${path}`, init);
  } catch (err) {
    throw new AdminApiError(`could not reach backend at ${base} -- ${err instanceof Error ? err.message : String(err)}`);
  }
}

// -- flows -------------------------------------------------------------

export async function listFlows(wsUrl: string): Promise<string[]> {
  const res = await request(wsUrl, "/api/flows");
  if (!res.ok) throw new AdminApiError(`list flows failed: ${await parseErrorBody(res)}`);
  const body = (await res.json()) as { flows: string[] };
  return body.flows;
}

export async function readFlow(wsUrl: string, name: string): Promise<string> {
  const res = await request(wsUrl, `/api/flows/${encodeURIComponent(name)}`);
  if (!res.ok) throw new AdminApiError(`open flow "${name}" failed: ${await parseErrorBody(res)}`);
  return res.text();
}

export async function writeFlow(wsUrl: string, name: string, text: string): Promise<void> {
  const res = await request(wsUrl, `/api/flows/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  if (!res.ok) throw new AdminApiError(`save flow "${name}" failed: ${await parseErrorBody(res)}`);
}

export async function deleteFlow(wsUrl: string, name: string): Promise<void> {
  const res = await request(wsUrl, `/api/flows/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw new AdminApiError(`delete flow "${name}" failed: ${await parseErrorBody(res)}`);
}

// -- custom node packages ------------------------------------------------

export interface CustomNodePackageText {
  descriptor: string;
  implementation: string;
}

export async function listCustomNodes(wsUrl: string): Promise<string[]> {
  const res = await request(wsUrl, "/api/custom-nodes");
  if (!res.ok) throw new AdminApiError(`list custom nodes failed: ${await parseErrorBody(res)}`);
  const body = (await res.json()) as { customNodes: string[] };
  return body.customNodes;
}

export async function readCustomNode(wsUrl: string, name: string): Promise<CustomNodePackageText> {
  const res = await request(wsUrl, `/api/custom-nodes/${encodeURIComponent(name)}`);
  if (!res.ok) throw new AdminApiError(`load custom node "${name}" failed: ${await parseErrorBody(res)}`);
  const body = (await res.json()) as { descriptor: string; implementation: string };
  return { descriptor: body.descriptor, implementation: body.implementation };
}

// write/delete for custom nodes are provided for parity with admin_api.py's
// full route table (and because a future "save this custom node I'm
// authoring" UI will need exactly this, not a different shape), but
// nothing calls them yet -- the editor has no custom-node authoring UI
// today, only PaletteSidebar.vue's read-only "Load custom node..." picker.
// Named explicitly rather than silently built as unreachable dead code.
export async function writeCustomNode(wsUrl: string, name: string, descriptor: string, implementation: string): Promise<void> {
  const res = await request(wsUrl, `/api/custom-nodes/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descriptor, implementation }),
  });
  if (!res.ok) throw new AdminApiError(`save custom node "${name}" failed: ${await parseErrorBody(res)}`);
}

export async function deleteCustomNode(wsUrl: string, name: string): Promise<void> {
  const res = await request(wsUrl, `/api/custom-nodes/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw new AdminApiError(`delete custom node "${name}" failed: ${await parseErrorBody(res)}`);
}

// -- WiFi/MQTT-broker credentials ------------------------------------------
// docs/working-notes/outstanding-items/credential-storage-design.md.
// Same shape as the flow functions above -- a credential bundle is an
// opaque JSON blob to this module too, same as flow text; credential-
// types.ts is what knows a "wifi" bundle looks like {ssid, password}.

export type CredentialType = "wifi" | "mqtt-broker";

export async function listCredentials(wsUrl: string, type: CredentialType): Promise<string[]> {
  const res = await request(wsUrl, `/api/credentials/${type}`);
  if (!res.ok) throw new AdminApiError(`list ${type} credentials failed: ${await parseErrorBody(res)}`);
  const body = (await res.json()) as { credentials: string[] };
  return body.credentials;
}

export async function getCredential(wsUrl: string, type: CredentialType, name: string): Promise<Record<string, unknown>> {
  const res = await request(wsUrl, `/api/credentials/${type}/${encodeURIComponent(name)}`);
  if (!res.ok) throw new AdminApiError(`load ${type} credential "${name}" failed: ${await parseErrorBody(res)}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function putCredential(wsUrl: string, type: CredentialType, name: string, data: Record<string, unknown>): Promise<void> {
  const res = await request(wsUrl, `/api/credentials/${type}/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new AdminApiError(`save ${type} credential "${name}" failed: ${await parseErrorBody(res)}`);
}

export async function deleteCredential(wsUrl: string, type: CredentialType, name: string): Promise<void> {
  const res = await request(wsUrl, `/api/credentials/${type}/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw new AdminApiError(`delete ${type} credential "${name}" failed: ${await parseErrorBody(res)}`);
}
