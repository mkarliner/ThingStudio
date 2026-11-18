// SPDX-License-Identifier: Apache-2.0
// editor/src/install/catalogue.ts
//
// What the install page can put on a board, worked out from the same two sources the installed editor uses: the
// chip families in the built-in processor definitions (each one's `flash` block says which tool writes it and
// where the image starts) and the firmware catalogue (`firmware/builds.json`). No DOM and no network here, so the
// rules can be tested without a browser. Plan: docs/working-notes/online-editor-webserial-briefing.md, section D.
//
// The online build ships the catalogue it was built with and serves every image from its own origin (section C):
// a browser can't fetch GitHub release assets, and the page's CSP allows its own origin only. Each image is named
// by its sha256, so the file the page asks for is the file the catalogue pinned.

import type { DefinitionSet, ProcessorDef } from "../definitions/definitions.js";

/** One build as `firmware/builds.json` lists it. */
export interface CatalogueBuild {
  readonly id: string;
  readonly supplier: string;
  readonly family: string;
  readonly label: string;
  readonly infoUrl?: string;
  readonly runtime: "none" | "install";
  readonly note?: string;
  /** Where this build is written, when it differs from its family's address (a merged image goes at 0). */
  readonly address?: number;
  /** Newest first. */
  readonly versions: readonly { readonly version: string; readonly date: string; readonly url: string; readonly sha256: string }[];
}

export interface Catalogue {
  readonly serial?: number;
  readonly builds: readonly CatalogueBuild[];
}

/** A chip family the page can write. */
export interface InstallFamily {
  readonly id: string;
  readonly label: string;
  readonly tool: "esptool" | "uf2";
  /** esptool's chip id ("esp32s3"); null for UF2. */
  readonly chip: string | null;
  readonly address: number;
}

/** One build the page offers: its newest version, and where the image is on this site. */
export interface InstallBuild {
  readonly id: string;
  readonly family: InstallFamily;
  readonly label: string;
  readonly supplier: string;
  readonly runtime: "none" | "install";
  readonly note: string;
  readonly version: string;
  readonly sha256: string;
  /** The file name the catalogue's own URL ends in, used when a UF2 is saved for the user to drag. */
  readonly fileName: string;
  /** Path on this site: /firmware/<sha256>.<ext>. */
  readonly path: string;
  /** Where esptool writes it. Unused for UF2. */
  readonly address: number;
  /** False when this build's image wasn't on the machine that built the site, so it can't be offered. */
  readonly available: boolean;
}

/** The extension an image file has: .bin for esptool, .uf2 for a drive. */
export function imageExtension(tool: InstallFamily["tool"]): "bin" | "uf2" {
  return tool === "uf2" ? "uf2" : "bin";
}

/** The path an image is served at. One name per pinned file, so a new image never replaces an old one in a cache. */
export function imagePath(sha256: string, tool: InstallFamily["tool"]): string {
  return `/firmware/${sha256}.${imageExtension(tool)}`;
}

/** The families the page can write: every processor whose definition says how to flash it. */
export function installFamilies(definitions: DefinitionSet): InstallFamily[] {
  const out: InstallFamily[] = [];
  for (const proc of definitions.processors.values()) {
    const family = familyOf(proc);
    if (family) out.push(family);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function familyOf(proc: ProcessorDef): InstallFamily | null {
  if (!proc.flash) return null;
  return { id: proc.id, label: proc.name, tool: proc.flash.tool, chip: proc.flash.chip, address: proc.flash.address };
}

/** Every build the page offers, newest version only, in catalogue order. `mirrored` is the set of sha256s whose
 * image is on this site; a build outside it is listed as unavailable rather than dropped, so a missing image is
 * visible instead of silently shrinking the list. */
export function installBuilds(catalogue: Catalogue, families: readonly InstallFamily[], mirrored: ReadonlySet<string>): InstallBuild[] {
  const byId = new Map(families.map((f) => [f.id, f]));
  const out: InstallBuild[] = [];
  for (const build of catalogue.builds) {
    const family = byId.get(build.family);
    const newest = build.versions[0];
    if (!family || !newest) continue;
    out.push({
      id: build.id,
      family,
      label: build.label,
      supplier: build.supplier,
      runtime: build.runtime,
      note: build.note ?? "",
      version: newest.version,
      sha256: newest.sha256,
      fileName: newest.url.split("/").pop() || `${build.id}-${newest.version}.${imageExtension(family.tool)}`,
      path: imagePath(newest.sha256, family.tool),
      address: build.address ?? family.address,
      available: mirrored.has(newest.sha256),
    });
  }
  return out;
}

/** The family esptool-js found, from its chip name ("ESP32-S3" -> the processor whose esptool chip is "esp32s3"). */
export function familyForChipName(chipName: string, families: readonly InstallFamily[]): InstallFamily | null {
  const chip = chipName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return families.find((f) => f.tool === "esptool" && f.chip === chip) ?? null;
}

/** The builds for one family, ThingStudio's own first (the runtime is already in them), then the rest in
 * catalogue order. The first available one is the page's default. */
export function buildsForFamily(builds: readonly InstallBuild[], familyId: string): InstallBuild[] {
  const mine = builds.filter((b) => b.family.id === familyId);
  return [...mine.filter((b) => b.supplier === "thingstudio"), ...mine.filter((b) => b.supplier !== "thingstudio")];
}

/** What to do after a build is written: the runtime is the next step on this page for every build (ThingStudio's
 * own images carry it but still need their boot file). */
export function nextStepLine(build: InstallBuild): string {
  if (build.supplier === "thingstudio") {
    return "Next: Install runtime, below. This image already carries the runtime, so it writes only the boot file.";
  }
  if (build.runtime === "install") return "Next: Install runtime, below.";
  return "Next: open the editor and click Connect.";
}

/** One line for a failed check of a downloaded image. */
export function hashMismatchLine(build: InstallBuild, got: string): string {
  return `The image for ${build.label} ${build.version} doesn't match the catalogue (expected ${build.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…). Nothing was written. Reload the page and try again; if it happens again, please report it.`;
}

/** Espressif's USB vendor id, and the product id of the chip's built-in USB-Serial/JTAG (what an S3/C3/C6 shows
 * in download mode, or when its own USB is left to the ROM). */
export const ESPRESSIF_VID = 0x303a;
export const USB_JTAG_SERIAL_PID = 0x1001;

/** What to say when Connect gets no bootloader. A board on the chip's own USB that's running its own firmware
 * (Espressif's vendor id, any other product id) can't be followed by a web page into download mode: the reset
 * brings up a new USB device, a port the page hasn't been given (2026-11-18, Mike's Tidal badge, EMF 2022). It needs
 * download mode by hand, then the new port picked. Anything else gets the usual BOOT/RESET advice. */
export function connectFailureLine(ids: { usbVendorId?: number; usbProductId?: number }, error: string): string {
  if (ids.usbVendorId === ESPRESSIF_VID && ids.usbProductId !== USB_JTAG_SERIAL_PID) {
    return `Connect: this board uses the chip's own USB and is running its own firmware, so the page can't switch it to download mode (${error}). Unplug it, hold BOOT while you plug it back in, then Connect and pick its port again: it has a new name in download mode.`;
  }
  return `Connect: the board didn't answer as an ESP32 bootloader (${error}). Hold BOOT, tap RESET, release BOOT, then Connect again.`;
}

/** The product ids the ROM bootloader shows on the chip's own USB (USB-OTG download mode): esptool-js's
 * IMAGE_CHIP_ID for the S2 and S3. A port with one of these is the bootloader, not MicroPython. */
export const ROM_USB_OTG_PIDS: ReadonlySet<number> = new Set([0x0002, 0x0009]);

/** True when a port is a chip's ROM bootloader on its own USB: it stays there after a write until RESET is pressed,
 * then comes back as a different USB device (2026-11-18, Mike's S2 Mini). */
export function isRomUsbBootloader(ids: { usbVendorId?: number; usbProductId?: number }): boolean {
  return ids.usbVendorId === ESPRESSIF_VID && ids.usbProductId !== undefined && ROM_USB_OTG_PIDS.has(ids.usbProductId);
}
