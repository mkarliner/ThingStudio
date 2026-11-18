// SPDX-License-Identifier: Apache-2.0
// editor/src/install/main.ts
//
// The install page (install.html, online build only): puts MicroPython, or ThingStudio's own image, on a board from
// the browser. ESP32 chips are written over Web Serial with esptool-js; UF2 boards (Pico, nRF52) get their file to
// drag onto the drive their bootloader shows. Plan: docs/working-notes/online-editor-webserial-briefing.md,
// sections C and D. The runtime install step joins this page when the raw-REPL port lands (task 4).
//
// One deterministic path per kind of board, as the installed editor's dialog has (AGENTS.md, fault handling):
// connect -> the chip says what it is -> pick an image -> confirm the erase -> download and check it -> write ->
// reset. Each failure says which step, what came back, and what to do; nothing is retried on the user's behalf.

import { ESPLoader, Transport, type IEspLoaderTerminal } from "esptool-js";
import { catalogue, mirrored } from "virtual:firmware-catalogue";
import { BUILTIN_DEFINITION_FILES } from "../definitions/builtin.js";
import { buildDefinitionSet } from "../definitions/definitions.js";
import {
  buildsForFamily,
  familyForChipName,
  hashMismatchLine,
  installBuilds,
  installFamilies,
  nextStepLine,
  type InstallBuild,
} from "./catalogue.js";

/** esptool-js talks to the ROM at 115200, then switches up for the write. 460800 is what the installed editor's
 * esptool uses for the same chips (processor descriptors' flash recipes, 2026-10-25). */
const ROM_BAUD = 115200;
const FLASH_BAUD = 460800;

const definitions = buildDefinitionSet(BUILTIN_DEFINITION_FILES, []);
const families = installFamilies(definitions);
const builds = installBuilds(catalogue, families, new Set(mirrored));

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`install.html has no #${id}`);
  return node as T;
};

const status = el("status");
const next = el("next");

function say(text: string, cls: "" | "ok" | "err" | "warn" = ""): void {
  status.textContent = text;
  status.className = cls;
}

function showNext(text: string): void {
  next.textContent = text;
  next.hidden = false;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function optionLabel(build: InstallBuild, withFamily: boolean): string {
  const who = build.supplier === "thingstudio" ? "ThingStudio" : "MicroPython";
  const what = withFamily ? `${build.family.label}: ${build.label}` : build.label;
  return `${what} — ${who} ${build.version}${build.available ? "" : " (not on this site)"}`;
}

function fillSelect(select: HTMLSelectElement, list: readonly InstallBuild[], withFamily: boolean): void {
  select.replaceChildren(
    ...list.map((build) => {
      const opt = document.createElement("option");
      opt.value = build.id;
      opt.textContent = optionLabel(build, withFamily);
      opt.disabled = !build.available;
      return opt;
    }),
  );
  // The first build that can be written; if none can, still show the first, so the list says why rather than
  // showing nothing.
  const first = list.find((b) => b.available) ?? list[0];
  if (first) select.value = first.id;
}

function selected(select: HTMLSelectElement): InstallBuild | undefined {
  return builds.find((b) => b.id === select.value);
}

/** Downloads the build's image from this site and checks it against the catalogue's sha256 before anything uses it. */
async function fetchImage(build: InstallBuild): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(build.path, { cache: "no-cache" });
  } catch (err) {
    throw new Error(`Couldn't download the image (${errorText(err)}). Check the connection and try again.`);
  }
  if (!res.ok) throw new Error(`The image for ${build.label} isn't on this site (HTTP ${res.status}). Please report it.`);
  const data = new Uint8Array(await res.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== build.sha256) throw new Error(hashMismatchLine(build, hex));
  return data;
}

// --- Which kind of board -------------------------------------------------------------------------------------

const hasSerial = "serial" in navigator;
el("noSerial").hidden = hasSerial;
el<HTMLButtonElement>("kindEsp").disabled = !hasSerial;

function choose(kind: "esp" | "uf2"): void {
  el("esp").hidden = kind !== "esp";
  el("uf2").hidden = kind !== "uf2";
  el("kindEsp").classList.toggle("primary", kind === "esp");
  el("kindUf2").classList.toggle("primary", kind === "uf2");
  next.hidden = true;
  say("");
}
el("kindEsp").addEventListener("click", () => choose("esp"));
el("kindUf2").addEventListener("click", () => choose("uf2"));

// --- ESP32: Web Serial and esptool-js -------------------------------------------------------------------------

interface Session {
  transport: Transport;
  loader: ESPLoader;
}
let session: Session | null = null;
let busy = false;

const espBuild = el<HTMLSelectElement>("espBuild");
const espConfirm = el<HTMLInputElement>("espConfirm");
const btnWrite = el<HTMLButtonElement>("btnWrite");
const btnConnect = el<HTMLButtonElement>("btnConnect");
const espProgress = el<HTMLProgressElement>("espProgress");

/** esptool-js writes its own log here. Kept for the console, so a bug report can carry it; the page shows one line. */
const terminal: IEspLoaderTerminal = {
  clean: () => undefined,
  writeLine: (line) => console.info(`[esptool] ${line}`),
  write: (text) => console.info(`[esptool] ${text}`),
};

function updateWriteButton(): void {
  const build = selected(espBuild);
  btnWrite.disabled = busy || !session || !build?.available || !espConfirm.checked;
  el("espNote").textContent = build?.note ?? "";
}
espBuild.addEventListener("change", updateWriteButton);
espConfirm.addEventListener("change", updateWriteButton);

async function closeSession(): Promise<void> {
  const s = session;
  session = null;
  if (s) await s.transport.disconnect().catch(() => undefined);
}

btnConnect.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  btnConnect.disabled = true;
  next.hidden = true;
  el("espChosen").hidden = true;
  await closeSession();
  try {
    let port: ConstructorParameters<typeof Transport>[0];
    try {
      port = await (navigator as unknown as { serial: { requestPort(): Promise<typeof port> } }).serial.requestPort();
    } catch {
      say("No port chosen. Click Connect and pick the board's port.", "warn");
      return;
    }
    say("Talking to the chip's bootloader…");
    const transport = new Transport(port, false);
    const loader = new ESPLoader({ transport, baudrate: FLASH_BAUD, romBaudrate: ROM_BAUD, terminal });
    let description: string;
    try {
      description = await loader.main();
    } catch (err) {
      await transport.disconnect().catch(() => undefined);
      say(
        `Connect: the board didn't answer as an ESP32 bootloader (${errorText(err)}). Hold BOOT, tap RESET, release BOOT, then Connect again.`,
        "err",
      );
      return;
    }
    const family = familyForChipName(loader.chip.CHIP_NAME, families);
    if (!family) {
      await transport.disconnect().catch(() => undefined);
      say(
        `Found ${description}. ThingStudio has no image for this chip yet: get one from micropython.org/download and write it with Espressif's own tools.`,
        "warn",
      );
      return;
    }
    session = { transport, loader };
    const list = buildsForFamily(builds, family.id);
    fillSelect(espBuild, list, false);
    el("chipLine").textContent = `Found ${description}.`;
    el("espChosen").hidden = false;
    espConfirm.checked = false;
    say(list.some((b) => b.available) ? "Pick an image, tick the box, then Write it." : "No image for this chip is on this site.", "");
  } finally {
    busy = false;
    btnConnect.disabled = false;
    updateWriteButton();
  }
});

btnWrite.addEventListener("click", async () => {
  const build = selected(espBuild);
  const s = session;
  if (busy || !s || !build || !espConfirm.checked) return;
  busy = true;
  btnConnect.disabled = true;
  updateWriteButton();
  espProgress.hidden = false;
  espProgress.value = 0;
  try {
    say(`Downloading ${build.label} ${build.version}…`);
    let data: Uint8Array;
    try {
      data = await fetchImage(build);
    } catch (err) {
      say(errorText(err), "err");
      return;
    }
    say(`Erasing and writing ${build.label} ${build.version} (${Math.round(data.length / 1024)} KB). Don't unplug the board.`);
    try {
      await s.loader.writeFlash({
        fileArray: [{ data, address: build.address }],
        flashMode: "keep",
        flashFreq: "keep",
        flashSize: "keep",
        eraseAll: true,
        compress: true,
        reportProgress: (_file, written, total) => {
          espProgress.value = total > 0 ? Math.round((written / total) * 100) : 0;
        },
      });
    } catch (err) {
      say(
        `Write failed at ${espProgress.value}% (${errorText(err)}). The board has no working image now: Connect and write it again. If it fails at the same place, try another USB cable or port.`,
        "err",
      );
      await closeSession();
      el("espChosen").hidden = true;
      return;
    }
    espProgress.value = 100;
    try {
      await s.loader.after("hard_reset");
    } catch {
      // A board on native USB drops off the bus as it resets; that is the reset working, not a failure.
    }
    await closeSession();
    el("espChosen").hidden = true;
    say(`Written: ${build.label} ${build.version}. If the board doesn't restart by itself, press its RESET button.`, "ok");
    showNext(nextStepLine(build));
  } finally {
    busy = false;
    btnConnect.disabled = false;
    updateWriteButton();
  }
});

// --- UF2: a file to drag onto the board's drive ---------------------------------------------------------------

const uf2Build = el<HTMLSelectElement>("uf2Build");
const uf2Builds = builds.filter((b) => b.family.tool === "uf2");
fillSelect(uf2Build, uf2Builds, true);

function uf2Steps(build: InstallBuild | undefined): void {
  const steps = el("uf2Steps");
  if (!build) {
    steps.replaceChildren();
    return;
  }
  const lines =
    build.family.id === "nrf52840"
      ? ["Download the file.", "Plug the board in, then double-tap its reset button. A new drive appears.", "Drag the file onto that drive. The board restarts by itself when it's done."]
      : [
          "Download the file.",
          "Unplug the board. Hold its BOOTSEL button while you plug it back in, then let go. A drive called RPI-RP2 (RP2350 on a Pico 2) appears.",
          "Drag the file onto that drive. The board restarts by itself when it's done, and the drive disappears.",
        ];
  steps.replaceChildren(
    ...lines.map((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      return li;
    }),
  );
  el("uf2Note").textContent = build.available ? build.note : "This image isn't on this site.";
  el<HTMLButtonElement>("btnDownload").disabled = !build.available;
}
uf2Build.addEventListener("change", () => uf2Steps(selected(uf2Build)));
uf2Steps(selected(uf2Build));

el("btnDownload").addEventListener("click", async () => {
  const build = selected(uf2Build);
  if (!build || !build.available) return;
  say(`Downloading ${build.label} ${build.version}…`);
  try {
    const data = await fetchImage(build);
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = build.fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    say(`Saved ${build.fileName} to your downloads. Now steps 2 and 3.`, "ok");
    showNext(nextStepLine(build));
  } catch (err) {
    say(errorText(err), "err");
  }
});

// --- Start ---------------------------------------------------------------------------------------------------

el("version").textContent = __EDITOR_BUILD__.version ? `ThingStudio ${__EDITOR_BUILD__.version}.` : "";
choose(hasSerial ? "esp" : "uf2");
