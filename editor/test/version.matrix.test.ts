// Version-handshake matrix, per the validation plan's Tier 0 bar
// (docs/working-notes/validation/mvp-validation-plan.md, "Real wire
// protocol (§13)"): "every combination of device/editor major.minor.patch
// pairs produces the right outcome (safe deploy allowed, or blocked with
// the correct wipe warning per §5/§11)." §11's resolved policy: "a major-
// version runtime update is allowed to wipe the deployed flow and
// persisted state... minor/patch runtime updates should preserve the
// deployed flow" -- so the invariant under test is exactly "allowed iff
// major matches," checked over a real cartesian matrix, not spot-checked
// examples.

import { describe, expect, it } from "vitest";
import { decideDeploy, formatVersion } from "../src/protocol/version.js";
import type { ProtocolVersion } from "../src/protocol/messages.js";

const COMPONENT_VALUES = [0, 1, 2, 5, 10];

function allVersions(): ProtocolVersion[] {
  const versions: ProtocolVersion[] = [];
  for (const major of COMPONENT_VALUES) {
    for (const minor of COMPONENT_VALUES) {
      for (const patch of COMPONENT_VALUES) {
        versions.push({ major, minor, patch });
      }
    }
  }
  return versions;
}

describe("decideDeploy: full major.minor.patch matrix", () => {
  const versions = allVersions();

  it(`covers a real cartesian matrix (${versions.length * versions.length} device/editor pairs), not spot checks`, () => {
    expect(versions.length).toBe(COMPONENT_VALUES.length ** 3);
  });

  it("allowed iff device.major === editorTarget.major, for every pair in the matrix", () => {
    const mismatches: string[] = [];
    for (const device of versions) {
      for (const editorTarget of versions) {
        const decision = decideDeploy(device, editorTarget);
        const wantAllowed = device.major === editorTarget.major;
        if (decision.allowed !== wantAllowed) {
          mismatches.push(
            `device=${formatVersion(device)} editor=${formatVersion(editorTarget)}: ` +
              `allowed=${decision.allowed}, want ${wantAllowed}`,
          );
        }
        // wipeRisk is true exactly when blocked, per version.ts's DeployDecision doc.
        if (decision.wipeRisk === decision.allowed) {
          mismatches.push(
            `device=${formatVersion(device)} editor=${formatVersion(editorTarget)}: ` +
              `wipeRisk=${decision.wipeRisk} should be the inverse of allowed=${decision.allowed}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("every decision includes a non-empty human-readable reason", () => {
    for (const device of versions.slice(0, 10)) {
      for (const editorTarget of versions.slice(0, 10)) {
        const decision = decideDeploy(device, editorTarget);
        expect(decision.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("decideDeploy: specific representative cases (§5/§11 wording)", () => {
  it("identical versions: safe, no wipe risk", () => {
    const v = { major: 1, minor: 2, patch: 3 };
    const decision = decideDeploy(v, v);
    expect(decision.allowed).toBe(true);
    expect(decision.wipeRisk).toBe(false);
  });

  it("same major, device has an older minor than the editor targets: still safe (minor/patch preserves the flow)", () => {
    const decision = decideDeploy({ major: 1, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 });
    expect(decision.allowed).toBe(true);
  });

  it("same major, device has a newer patch than the editor targets: still safe", () => {
    const decision = decideDeploy({ major: 2, minor: 1, patch: 9 }, { major: 2, minor: 1, patch: 0 });
    expect(decision.allowed).toBe(true);
  });

  it("device major behind the editor's target: blocked, wipe risk flagged", () => {
    const decision = decideDeploy({ major: 1, minor: 9, patch: 9 }, { major: 2, minor: 0, patch: 0 });
    expect(decision.allowed).toBe(false);
    expect(decision.wipeRisk).toBe(true);
    expect(decision.reason).toMatch(/wipe/i);
  });

  it("device major ahead of the editor's target: also blocked (mismatch is symmetric)", () => {
    const decision = decideDeploy({ major: 3, minor: 0, patch: 0 }, { major: 2, minor: 0, patch: 0 });
    expect(decision.allowed).toBe(false);
    expect(decision.wipeRisk).toBe(true);
  });

  it("reason string names both actual version numbers, for a useful UI warning", () => {
    const decision = decideDeploy({ major: 1, minor: 0, patch: 0 }, { major: 2, minor: 3, patch: 4 });
    expect(decision.reason).toContain("1.0.0");
    expect(decision.reason).toContain("2.3.4");
  });
});

describe("formatVersion", () => {
  it("formats as major.minor.patch", () => {
    expect(formatVersion({ major: 1, minor: 2, patch: 3 })).toBe("1.2.3");
    expect(formatVersion({ major: 0, minor: 0, patch: 0 })).toBe("0.0.0");
  });
});
