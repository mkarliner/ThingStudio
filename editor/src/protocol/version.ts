// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/version.ts
//
// The version-handshake policy §5/§11 already resolved, made real:
// "HELLO reports the runtime version as major.minor.patch... so the
// editor can tell 'compatible, safe DEPLOY' apart from 'major mismatch,
// DEPLOY may wipe the flow and state store' and warn the user before it
// happens rather than after" (§13). §11: "a major-version runtime update
// is allowed to wipe the deployed flow and persisted state if the new
// runtime isn't compatible... minor/patch runtime updates should
// preserve the deployed flow."
//
// This file's job is the editor-side half of that policy: given the
// device's reported runtime version (HELLO) and the version this
// editor's compiler/codegen actually targets, decide whether sending a
// DEPLOY is safe -- gating the attempt itself, per §5's own framing
// ("a version-checked editor refusing to send a DEPLOY the device can't
// parse prevents this specific trigger before it starts"). There's no
// override to force a cross-major DEPLOY here: building one would need
// device-side support (does the device's listener even understand a
// DEPLOY from a different major protocol/codegen version well enough to
// safely wipe-and-replace?) that doesn't exist yet -- out of scope per
// this chat's briefing, same as the rest of the device-side listener.

import type { ProtocolVersion } from "./messages.js";

export interface DeployDecision {
  readonly allowed: boolean;
  /**
   * True when proceeding (or having proceeded) risks wiping the device's
   * deployed flow and state store (§5/§11). Only meaningful as UI-warning
   * context -- it doesn't independently gate anything `allowed` doesn't
   * already cover, since the only case that risks a wipe is also the
   * only case this file blocks.
   */
  readonly wipeRisk: boolean;
  readonly reason: string;
}

export function formatVersion(v: ProtocolVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * device: the version reported in the connected device's HELLO.
 * editorTarget: the runtime version this editor's compiler/codegen was
 * built against (i.e. what a DEPLOY from this editor assumes).
 */
export function decideDeploy(device: ProtocolVersion, editorTarget: ProtocolVersion): DeployDecision {
  if (device.major !== editorTarget.major) {
    return {
      allowed: false,
      wipeRisk: true,
      reason:
        `device runtime ${formatVersion(device)} is a different major version than this editor targets ` +
        `(${formatVersion(editorTarget)}). Deploying could wipe the device's flow and persisted state ` +
        `(design doc §5/§11), and the device may not even be able to parse this DEPLOY. Reconnect with a ` +
        `matching editor version, or reflash the device's runtime, before deploying.`,
    };
  }

  return {
    allowed: true,
    wipeRisk: false,
    reason: `device runtime ${formatVersion(device)} is compatible with this editor (targets ${formatVersion(editorTarget)}).`,
  };
}
