// SPDX-License-Identifier: Apache-2.0
// editor/src/app/demo-examples.ts
//
// The flows the online demo offers in its Examples menu (docs/working-notes/online-editor-demo-scoping.md,
// code item 5), bundled at build time: the demo never loads a flow from a URL. The first one opens on start.
// This is the one list -- add, remove or reorder entries here. `board` picks that board in the Board menu
// when the example opens, for a flow written for one board's pins; leave it out for a flow that runs anywhere.
// Only the demo build imports this file (demo.ts), so the normal editor bundle doesn't carry the flows.

import blink from "../../../tutorials/blink.flow.json?raw";
import twoMoreBlinks from "../../../tutorials/two-more-blinks.flow.json?raw";
import httpBlink from "../../../tutorials/http-blink.flow.json?raw";
import blinkFromAnywhere from "../../../tutorials/blink-from-anywhere.flow.json?raw";
import sensorDashboard from "../../../test-flows/gui-headliner-sensor-freenove-s3-4in.flow.json?raw";

export interface DemoExample {
  /** The menu item's text. */
  label: string;
  /** The flow file's text, as File → Open would read it. */
  text: string;
  /** A Board menu value ("board:<id>", the file name under definitions/boards/), or absent for Auto. */
  board?: string;
}

export const DEMO_EXAMPLES: readonly DemoExample[] = [
  { label: "Blink an LED", text: blink },
  { label: "Two more blinks", text: twoMoreBlinks },
  { label: "Web Blink: an LED from your browser", text: httpBlink },
  { label: "Blink from anywhere (MQTT)", text: blinkFromAnywhere },
  { label: "Sensor dashboard on a touchscreen", text: sensorDashboard, board: "board:freenove-s3-4in" },
];
