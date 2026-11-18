// SPDX-License-Identifier: Apache-2.0
// editor/src/app/edition.ts
//
// Two questions the editor asks instead of "is this the demo?" (docs/working-notes/online-editor-webserial-briefing.md,
// task 1). Whether there is a backend is fixed when the editor is built: the installed editor has one, the online
// build (`vite build --mode demo`, __DEMO__) doesn't. Whether the page can reach a board is decided when it loads:
// the installed editor always can (through the backend); the online one can when the browser has Web Serial
// (Chrome or Edge on a desktop). Anything in between -- Firefox, Safari, a phone -- gets the demo as it was.
//
// Code that needs the backend tests `__DEMO__` itself, inline, so the bundler drops it from the online build
// (test/demo-build.test.ts checks); these runtime values only say whether board controls are offered.

/** The browser can open a serial port itself. */
export const WEB_SERIAL = typeof navigator !== "undefined" && "serial" in navigator;

/** Board controls are offered: always in the installed editor, and online when the browser has Web Serial. */
export const CAN_REACH_BOARD = !__DEMO__ || WEB_SERIAL;

/** The online build in a browser that can reach a board. */
export const ONLINE_WITH_BOARD = __DEMO__ && WEB_SERIAL;
