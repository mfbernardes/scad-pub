// Tests the pure logic behind the after-export success panel
// (src/lib/exportOutcome.ts): outcome -> wording key, auto-hide duration, and
// the install-hint precedence rule. See ExportSuccess.tsx / App.tsx's
// exportModel for how these get wired into the real UI — this file only
// exercises the framework-free decision functions themselves.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterExportAutoHideMs,
  exportOutcomeTitleKey,
  shouldOfferInstallHint,
} from "../src/lib/exportOutcome.ts";

test("exportOutcomeTitleKey: a real browser download maps to the downloaded wording", () => {
  assert.equal(exportOutcomeTitleKey("downloaded"), "export.downloaded");
});

test("exportOutcomeTitleKey: a completed Web Share API handoff maps to the modest readyToShare wording, not an overclaiming 'completed'", () => {
  // See exportOutcome.ts's file doc: navigator.share() resolving only proves
  // the OS handed the file to the chosen app, not that anything happened
  // there, so this deliberately does NOT map to a "shared"/"completed" key.
  assert.equal(exportOutcomeTitleKey("shared"), "export.readyToShare");
});

test("afterExportAutoHideMs: longer on the first-ever show, quieter after that", () => {
  assert.equal(afterExportAutoHideMs(true), 15000);
  assert.equal(afterExportAutoHideMs(false), 6000);
  assert.ok(afterExportAutoHideMs(true) > afterExportAutoHideMs(false));
});

test("shouldOfferInstallHint: fires only when the after-export panel isn't configured", () => {
  assert.equal(shouldOfferInstallHint(false), true);
  assert.equal(shouldOfferInstallHint(true), false);
});
