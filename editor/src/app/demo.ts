// SPDX-License-Identifier: Apache-2.0
// editor/src/app/demo.ts
//
// The online demo's own controls (docs/working-notes/online-editor-demo-scoping.md): the Examples menu, the
// Compile button, the version in the banner, and the example it opens with. main.ts calls startDemo() only
// when __DEMO__ is set, so none of this is in the normal editor bundle. What the demo leaves out (Connect,
// Deploy, Tools, the console's command line) is hidden by index.html's CSS and gated out of main.ts.

import { DEMO_EXAMPLES, type DemoExample } from "./demo-examples.js";
import { putCredential, type CredentialType } from "./rete/saved-values.js";

/** Made-up values for the WiFi networks and brokers the examples use, so every example compiles as it opens.
 * They live in this page's memory only (saved-values.ts), like anything a visitor types into those fields. */
const DEMO_CREDENTIALS: Record<"wifi" | "mqtt-broker", { name: string; values: Record<string, unknown> }> = {
  wifi: { name: "demo-wifi", values: { ssid: "demo-network", password: "made-up-password" } },
  "mqtt-broker": { name: "demo-broker", values: { broker: "broker.example.com", port: 1883, username: "", password: "" } },
};
const CREDENTIAL_OF_CONFIG: Record<string, "wifi" | "mqtt-broker"> = {
  "thingstudio/config/wifi": "wifi",
  "thingstudio/config/mqtt-broker": "mqtt-broker",
};

/** The example's text with every WiFi and broker config pointing at a credential that has made-up values. A
 * config that names a credential keeps its name; one that names none gets the demo's. "Unmanaged" WiFi (the
 * board connects itself) needs none. Text that isn't JSON is returned as it is, for File → Open's own error. */
async function withDemoCredentials(text: string): Promise<string> {
  let flow: { configs?: { type?: unknown; properties?: Record<string, unknown> }[] };
  try {
    flow = JSON.parse(text);
  } catch {
    return text;
  }
  for (const cfg of Array.isArray(flow.configs) ? flow.configs : []) {
    const type = typeof cfg?.type === "string" ? CREDENTIAL_OF_CONFIG[cfg.type] : undefined;
    if (!type) continue;
    const props = (cfg.properties ??= {});
    if (type === "wifi" && props.security === "unmanaged") continue;
    const name = typeof props.credentialName === "string" && props.credentialName ? props.credentialName : DEMO_CREDENTIALS[type].name;
    props.credentialName = name;
    await putCredential(type as CredentialType, name, DEMO_CREDENTIALS[type].values);
  }
  return JSON.stringify(flow);
}

/** What the demo needs from main.ts, which owns the canvas, the compiler and the console. */
export interface DemoHooks {
  /** Loads a flow file's text onto the canvas, as File → Open does. */
  openFlowText(text: string): Promise<void>;
  /** Sets the Board menu to `choice` ("board:<id>", or "auto"). */
  chooseBoard(choice: string): void;
  /** Compiles the flow and shows the Python it makes. */
  compile(): Promise<void>;
  log(text: string, cls?: "ok" | "err" | ""): void;
  /** The editor's version, for the banner. */
  versionLabel: string;
}

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export async function startDemo(hooks: DemoHooks): Promise<void> {
  el("demo-version").textContent = hooks.versionLabel;

  async function open(example: DemoExample): Promise<void> {
    try {
      await hooks.openFlowText(await withDemoCredentials(example.text));
      hooks.chooseBoard(example.board ?? "auto");
    } catch (err) {
      hooks.log(`[demo] couldn't open "${example.label}": ${err instanceof Error ? err.message : String(err)}`, "err");
    }
  }

  const list = el("examplesMenuList");
  for (const example of DEMO_EXAMPLES) {
    const item = document.createElement("button");
    item.setAttribute("role", "menuitem");
    item.textContent = example.label;
    item.addEventListener("click", () => void open(example));
    list.appendChild(item);
  }

  el("btnCompile").addEventListener("click", async () => {
    const button = el<HTMLButtonElement>("btnCompile");
    button.disabled = true;
    try {
      await hooks.compile();
    } finally {
      button.disabled = false;
    }
    const preview = el<HTMLDetailsElement>("previewPanel");
    preview.open = true;
    preview.scrollIntoView({ block: "nearest" });
  });

  hooks.log("[demo] No board here: Compile shows the Python a board would run. Examples ▾ has more flows.", "");
  const first = DEMO_EXAMPLES[0];
  if (first) await open(first);
}
