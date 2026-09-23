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

export interface BuildCheck {
  readonly status: "match" | "mismatch" | "unknown";
  readonly reason: string;
}

/**
 * The belt-and-braces companion to decideDeploy, added 2026-09-05 (see
 * CLAUDE.md's "Device-runtime version bump discipline" and this file's
 * own header for why decideDeploy's manually-bumped semver alone isn't
 * enough -- confirmed by the register_trigger incident, where a real
 * device-runtime/src change shipped without either version const being
 * touched). Purely informational -- unlike decideDeploy, nothing here
 * gates a DEPLOY; this only ever produces a log line for a human to act
 * on. Deliberately a plain equality check on a git SHA, not a content
 * hash: a hash would flag a same-behavior comment/rename edit as
 * "mismatch" with no way to tell how much actually changed or why, where
 * a SHA lets a real mismatch be followed up with `git diff`/`git log`
 * against device-runtime/src.
 *
 * device: the connected board's HELLO.runtimeBuild.
 * editorBuild: this editor's own build-time SHA (main.ts's
 * EDITOR_RUNTIME_BUILD, sourced from vite.config.ts's `define`).
 */
export function checkRuntimeBuild(device: string | null, editorBuild: string | null): BuildCheck {
  if (editorBuild === null) {
    return {
      status: "unknown",
      reason: "this editor build has no runtime-build SHA of its own (git wasn't available when it was built/started) -- can't compare.",
    };
  }
  if (device === null) {
    return {
      status: "unknown",
      reason:
        "device reported no runtimeBuild -- its runtime was installed by a version that didn't record one, or " +
        'git info wasn\'t available at install time. Not confirmed stale, just unconfirmed. Clicking "Install ' +
        'runtime…" again records it.',
    };
  }
  if (device === editorBuild) {
    return { status: "match", reason: `device runtime build ${device} matches this editor's (${editorBuild}).` };
  }
  return {
    status: "mismatch",
    reason:
      `device runtime build ${device} differs from this editor's (${editorBuild}) -- device-runtime/src has ` +
      `changed since this board was last bootstrapped. The semver check above may still say "compatible" if ` +
      `nobody bumped it for the change (see CLAUDE.md) -- if anything behaves unexpectedly, re-run ` +
      `test-flows/deploy_runtime.py against this board before assuming it's a real bug.`,
  };
}
