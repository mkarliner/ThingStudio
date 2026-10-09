// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/touch-panel-shared.ts
//
// The touch panel as a config node (2026-10-09, button rework; Mike: GUI-only plumbing shouldn't be on the canvas,
// and touch_i2c is for non-GUI uses). `thingstudio/config/touch-panel` holds the controller, its I2C bus (a
// reference to an I2C bus config), address, reset pin, poll interval and the panel's geometry. Two kinds of node
// name one by `touchPanelConfigId`:
//   gui_screen   polls it itself (GUI.poll_touch) and turns touches into button presses; no wire
//   touch_i2c    sends raw {x, y} down/up messages, for non-GUI uses
// One physical panel can't feed both, or two screens: whichever polled it would steal touches from the other. That
// is a CompileError naming both nodes.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext } from "../compiler/node-definition.js";
import { checkPin } from "../definitions/pin-check.js";
import { nodeLabel } from "../gui/screens.js";
import { resolveI2cBus, type I2cBusSetup } from "./i2c-shared.js";

export const TOUCH_PANEL_CONFIG_TYPE = "thingstudio/config/touch-panel";
/** Node types that reference a touch panel config through `touchPanelConfigId`. */
export const TOUCH_PANEL_NODE_TYPES = ["thingstudio/gui_screen", "thingstudio/touch_i2c"];

export interface TouchPanelSetup {
  bus: I2cBusSetup;
  pollMs: number;
  /** "FT6336U at 0x38 on I2C bus 0": what status messages call the panel. */
  where: string;
  /** Python expression building the driver; the driver's read() returns None or (x, y). */
  makeDevice: string;
  imports: string[];
}

function whole(props: Record<string, unknown>, key: string, dflt: number, min: number, what: string): number {
  const raw = props[key];
  const v = raw === undefined || raw === null || raw === "" ? dflt : Number(raw);
  if (!Number.isInteger(v) || v < min) throw new CompileError(`touch panel ${what} "${String(raw)}" must be a whole number, ${min} or more`);
  return v;
}

/** The nodes (other than `node`) that name the same touch panel config as `node` does. */
function otherClaimants(ctx: CodegenContext, node: GraphNode, configId: string): GraphNode[] {
  const out: GraphNode[] = [];
  for (const t of TOUCH_PANEL_NODE_TYPES) {
    for (const n of ctx.findNodesOfType?.(t) ?? []) {
      if (n.id !== node.id && n.properties.touchPanelConfigId === configId) out.push(n);
    }
  }
  return out;
}

/**
 * Resolves `node`'s `touchPanelConfigId` to a panel. Throws a CompileError when none is picked, the config is
 * incomplete, or another node uses the same panel.
 */
export function resolveTouchPanel(ctx: CodegenContext, node: GraphNode): TouchPanelSetup {
  const who = nodeLabel(node);
  const configId = node.properties.touchPanelConfigId;
  if (typeof configId !== "string" || configId === "") {
    throw new CompileError(`${who} has no touch panel. Pick one, or add one with +.`);
  }
  const other = otherClaimants(ctx, node, configId)[0];
  if (other) {
    throw new CompileError(
      `${who} and ${nodeLabel(other)} both use the same touch panel. A panel feeds one gui screen or one touch node, not both.`,
    );
  }
  const p = ctx.resolveConfig(configId);
  const controller = String(p.controller ?? "ft6336u");
  if (controller !== "ft6336u") throw new CompileError(`touch panel controller "${controller}" isn't supported yet (FT6336U only)`);
  const bus = resolveI2cBus(ctx, `touch panel for ${who}`, p.i2cConfigId);
  const address = whole(p, "address", 0x38, 0x08, "address");
  if (address > 0x77) throw new CompileError(`touch panel address "${String(p.address)}" must be 0x08 to 0x77`);
  const pollMs = whole(p, "pollMs", 20, 5, "poll interval");
  const width = whole(p, "width", 320, 1, "width");
  const height = whole(p, "height", 480, 1, "height");
  const py = (b: unknown) => (b === true ? "True" : "False");
  const rstRaw = p.rstPin;
  const hasRst = rstRaw !== undefined && rstRaw !== null && rstRaw !== "";
  const rst = hasRst ? `machine.Pin(${checkPin(ctx, "touch panel reset pin", rstRaw, "output")}, machine.Pin.OUT)` : "None";
  const hex = `0x${address.toString(16)}`;
  return {
    bus,
    pollMs,
    where: `FT6336U at ${hex} on I2C bus ${bus.bus}`,
    makeDevice: `ft6336u.FT6336U(${bus.varName}, ${address}, ${rst}, ${width}, ${height}, ${py(p.swapXY)}, ${py(p.flipX)}, ${py(p.flipY)})`,
    imports: ["import machine", "import ft6336u"],
  };
}
