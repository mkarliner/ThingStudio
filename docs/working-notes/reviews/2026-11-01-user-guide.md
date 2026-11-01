# User guide review after the first real tester

Status: review, 2026-11-01. Brief: `user-manual-review-briefing.md` (project doc). Scope: every page of
`docs/user-guide/` in `mkdocs.yml` nav order, on branch `docs/context-diet` (`21bb626`). Style judged against
`docs-style-guide.md` and Mike's remarks in `docs-style-review.md`; readability against the four learner profiles in
`docs/tester-ready.md`. `ai-authoring.md` and `nodes-catalog.md` checked for facts only.

A review records findings, not decisions. Each finding below is written to be acted on by an editing session that
has not seen this one. **[Fact]** marks a factual error and **[Fact?]** a claim still to verify; everything else is style, readability
or structure.

Facts were checked against the editor, backend and runtime source on this branch, not against a running editor.
Labels quoted as "the dialog's label" were read from `editor/index.html` and `editor/src`.

## Mike's remarks (2026-11-01, verbatim)

On the brief, before the pass:

> you are also looking for human readability and good style

Answers to the stage 1 questions (the questions are paraphrased in brackets; answers verbatim):

1. [Keep or drop `installation-details.md`'s "Install a specific version" (`THINGSTUDIO_VERSION`)?] First "explain",
   then:
   > drop it, but I need an uninstall script for me at least so I can easily repeat the install process
2. [Change the MQTT console message, or only the docs?] First "explain", then, choosing "docs plus a plainer console
   line for unreachable-broker failures":
   > the second
3. [Which broker should a stranger use in the MQTT tutorial?]
   > they can use test.mosquitto.org - but remember it's public so anyone can see and you need to use a unique
   > topic, maybe a random number, or a local broker if they have one.
4. [Should Check a flow and Command line, which need a source checkout, stay in the user manual?]
   > developer section
5. [A sensor display: keep as the third tutorial, or turn into a worked example?]
   > work in progress - mark it as such and ignore for the moment
6. [Document the hidden `gui navigator` and modals laid out only by editing the flow file?]
   > left out
7. [Merge `gui-layout.md` into `gui.md`?]
   > yes

Notes on the remarks, for the editing session:

- **1:** the installer already uninstalls (`install.sh --uninstall`, `install.ps1 -Uninstall`) and keeps
  `~/.thingstudio`. For a repeat "stranger" install, Mike also needs `~/.thingstudio` moved aside (credentials,
  presets, first-run custom-node examples). Given to him in the conversation; see Installation details, finding 2,
  for what the page should say.
- **2:** the console change is code, not docs. Suggested home: the editor's error-help layer (as
  `connect-error-help.ts` does for board connects), so no runtime reinstall is needed. Log it as an outstanding item.
  The docs half is Gaps, item 1.
- **3:** shapes the MQTT tutorial (Gaps, item 2) and the MQTT troubleshooting entry (Gaps, item 1).
- **5:** "ignore for the moment" covers this review's findings on `sensor-display.md`: they are recorded, but its
  only near-term change is a work-in-progress note (see that page).

## Summary

From install to a blinking LED, a stranger succeeds from the docs alone: Getting started is the strongest section.
Past it the manual is uneven. About half reads as one author applying the guide; the rest is in the pre-guide voice
(asides, self-praise, repetition, internal names, history). Tutorial 2 can't be followed by building. Several pages
contradict each other, and memory advice is spread over four pages while the one thing testers misread (`[memory]`)
is explained nowhere.

## Cross-cutting findings

### C1. Openings that describe the page

Rule: "Open with what the page is for", plus Mike's three 2026-10-11 remarks (Editor in depth, WiFi provisioning,
Getting started): no sentences about the page; a page of unrelated reference topics needs no opening at all.
Openings that slipped back:

- `working-in-the-editor.md`: "How the editor's wiring, node labels, presets, config nodes and node status work."
  Mike asked for no intro on this page. Delete the line.
- `flow-lifecycle.md`: "How a flow is saved, opened, deployed and disconnected." Delete.
- `debugging.md`: "What the console and compiled source show, and what to do when a board or deploy fails." Delete
  (its log says the opening was removed on 2026-10-11; it came back).
- `editor-tour.md`: "A tour of the editor, naming each part of the screen." Delete; keep the "Start Thingstudio if
  it isn't running" line.
- `nodes/index.md`: "Every built-in node has its own page… This page lists them all…". Replace with nothing, or
  with the "Which node do I need?" table moved to the top.
- `command-line.md`, `gui-layout.md`, `installation-details.md`: see their pages.

### C2. The pre-guide voice on reference pages

Rules: Voice (neutral, no chattiness), Say what's true now, Words ("just", "simply", "actually"). The 2026-10-11
node rewrite fixed layout, not wording, and some pages were written after it. Patterns, with examples:

- **Self-praise.** "raises a clear error rather than failing silently" (`http-response.md`, `display-i2c.md`,
  `display-spi.md`, `udp-send.md` as "a clear error … not a bare error code"). Say what the error says, or nothing.
- **Chattiness and asides.** "so it pays to know this up front" (`delay.md`), "A few real limitations worth knowing"
  (`http-request.md`), "genuinely event-driven, not polled" (`interrupt.md`), "rarely needs changing"
  (`udp-receive.md`), "a slightly-out-of-bounds computed value won't crash the flow" (`pwm-out.md`), "the way to see
  what's actually flowing through a wire" and "without guessing" (`debug.md`), the TiDAL badge aside (`ebutton.md`;
  the 2026-10-11 log says it was removed from display-spi, it survives here).
- **The same sentence twice on one page.** "Uses the flow's WiFi network (its **WiFi** field, shared by every WiFi
  node)" appears in Properties and again in Behavior on `udp-receive.md`, `udp-send.md`, `http-request.md`,
  `http-in.md`, `wifi-gate.md`. Keep the Properties line only.
- **Internal names.** "`outputCount` in the flow file" (`function.md`), "`addr` in the flow file"
  (`display-i2c.md`), "wifi_status" (`wifi-status.md`), "`gui_screen`" (`gui.md`, modal section), "flow-boot
  time" (`display-spi.md`), "the card demo's scheme" (`gui.md`).
- **History.** "A flow saved before I2C buses existed…" (`display-i2c.md`), "An older flow may still use a shared GUI
  theme config" (`gui.md`), "The editor used to stop the running flow and retry" (`faq.md`), "That is normal now and
  then" (`debugging.md`).
- **Defending design choices.** "Deploy does not try to fix this for you: … because freeing or restarting on your
  behalf would leave the board in a state you didn't choose" (`debugging.md`), "Because a repair nobody asked for
  hides the limit" (`faq.md`), "a board that can't take 5 KB has a memory problem worth seeing rather than one to
  work around" (`faq.md`), "That is a limit of the board, not a fault in the flow" (`debugging.md`). State the
  behavior and what to do; drop the justification.
- **Spelling.** UK forms against the guide's US: "colour" (`function.md`, `gui.md`, `neopixel.md` prose,
  `display-spi.md`), "catalogue" (`debugging.md`), "recognises", "greys" (`boards.md`). Keep `neopixel`'s
  `'colour'` payload key: that is the code's name.

### C3. Node pages off the fixed layout

Rule: Page types, node page (purpose, Properties, Wiring, Behavior, Errors). No `## Wiring` on: `inject`, `timer`,
`delay`, `debug`, `gpio out`, `pwm out`, `interrupt`, `eswitch`, `ebutton`, `wifi status`, `wifi gate`,
`udp receive`, `udp send`, `http request`, `http in`, `http response`, `mqtt publish`, `mqtt subscribe`, `change`,
`filter`. On these, the input and output are described inside Behavior; move them to Wiring with the **Input** /
**Output** lead-in used on `bme280.md`. Errors are buried in Behavior on `http request`, `http in`,
`http response`, `udp send`, `mqtt subscribe`, `filter`, `journal`; give each an `## Errors` section.

### C4. Plans, internal files and "work in progress" in the manual

Rule: Say what's true now (planned features only on one labelled page). `tutorials/index.md` ("More are coming, in
this order…"), `tutorials/blink-from-your-network.md` ("publish and subscribe over MQTT is next to be written"),
`faq.md` ("See the deferred note on modem sleep in `working-notes/outstanding-items.md`", a file the reader doesn't
have). Remove all three. Exception, by Mike's remark 5: `sensor-display.md` gets an explicit work-in-progress note.

### C5. Contradictions between pages

Learner profile: Reader ("no contradictions"). Each is listed again under its pages.

1. **Custom node shape.** `node-conventions.md` says "A custom node has one input and one output" and "there are no
   event-driven custom sources". `custom-nodes.md` documents `eventSource` and `runOnce` sources, transforms with
   "one or more out", and two-faced nodes. **[Fact]** `node-conventions.md` is the one out of date.
2. **Unmanaged WiFi and MQTT.** `wifi-provisioning.md` says to set security to Unmanaged; `mqtt-publish.md` and
   `mqtt-subscribe.md` say Unmanaged "isn't accepted here". The provisioning page doesn't say MQTT flows can't use it.
3. **Two layout models in `gui.md`.** "Laying out pages" describes a cell grid (row, col, row span, col span via ⚙)
   and then "A page is a tree of `row` and `column` containers". Themes says "tick **card** on a row or column";
   Laying out pages says "tick **panel** to draw a card". Check the editor and keep one model and one label.
4. **Stock or custom image.** `custom-firmware.md`'s second paragraph says stock MicroPython "is what
   Installing MicroPython sets out"; `installing-micropython.md` now advises the custom image for classic ESP32s.
5. **`display-spi.md` lists `palette` twice** in Properties, with different text.
6. **Example flows.** `index.md` says `examples/blink.flow.json` is in "your install folder";
   `sensor-display.md` sends the reader to GitHub for a flow that also ships in `examples/`
   (`tools/make_bundle.py` copies `examples/` to the bundle root). No page says where the install folder is for an
   installer-script install (`~/.local/share/thingstudio/examples/` on macOS/Linux,
   `%LOCALAPPDATA%\Thingstudio\examples\` on Windows; confirm against the installer).

### C6. Memory: repeated everywhere, explained nowhere

Rule: One home for changing facts; learner profiles Adventurer (where to look) and Reader. "A soft restart doesn't
give the memory back; power cycle" is told in `debugging.md` (MemoryError section and Restarting the board),
`faq.md` (seven memory questions) and `custom-firmware.md` (Memory and the board). Measured figures appear in three
places (FAQ table, custom firmware table, Freenove 121 KB → 7.8 MB). Meanwhile known finding 3 (the tester read
`ESP-IDF heap 27 KB free` as the cause of an MQTT failure) has no answer, and `debugging.md`'s Memory section invites
the same reading ("If WiFi won't join while MicroPython has plenty free, a low ESP-IDF figure is the likely cause").

Change: one home, `debugging.md` "Memory", that says (a) what each number on the `[memory]` line is, (b) which one
matters when (MicroPython largest block for a deploy or a big buffer; ESP-IDF free for WiFi starting), (c) that a
real memory failure says `MemoryError` or names memory, so a network error with a low figure beside it is still a
network error, and (d) the recover recipe once. The FAQ keeps one-line answers that link there; custom firmware keeps
only what is specific to the image.

### C7. Tutorials' voice

Rule: Voice ("A tutorial's title may carry a light touch; its body stays neutral"). Both tutorials lean on dashes
and asides: "That works.", "Lost it?", "the blink is over; the switch is yours", "One line on the open port" (a
heading), "Next, pick:" (a heading with a colon, also on `first-flow.md`). Rewrite to plain statements; rename
"Next, pick:" to "Next".

### C8. Pages that need a source checkout

By Mike's remark 4, `check-a-flow.md` and `command-line.md`'s runtime and `device_cli.py` sections move to a
developer section. They use `npm ci` in `editor/` and `test-flows/` scripts, which a package or installer user doesn't
have, and neither says so up front.

## Per-page findings

Word counts are from `wc -w` on 2026-11-01 (see Checks).

### Home: `index.md` (1106): light edit

1. "In practice, that means:" follows the "For the impatient" tip, so "that" has nothing to point at. Move the tip
   below the list, or start the list "Thingstudio is:".
2. "They diff cleanly and sit happily in a git repository" — "sit happily" is chatty. "They diff cleanly in git."
3. "Running on the board" repeats the second paragraph of the page (flow saved on the board, runs after a restart).
   Cut the repeat from one of them.
4. "What's different…" re-explains event-driven programming, which `background/event-driven.md` and
   `coming-from/arduino.md` also do. Keep Home's version short (the loop list, one paragraph) and link.
5. "changing a flow and trying it again takes seconds" — a duration; the 2026-10-11 log treats durations as sizing
   words. Same on `coming-from/arduino.md`. Say "without reflashing".
6. The impatient tip's step 5: say where the install folder is (C5.6).
7. Two tip admonitions within 30 lines; the second ("Already know the background?") could be a plain list under
   the intro.

### Background: `background/event-driven.md` (346): fine

1. "Most microcontroller programs start as a loop" duplicates Home's section; acceptable here as the home of the
   topic. Make this the one full explanation (see Home, finding 4).

### Background: `background/flows-and-nodes.md` (329): fine

1. "`topic`: a short label saying what the message is about" — "short" is a sizing word. "a label".

### Background: `background/node-red.md` (210): fine

### Background: `background/micropython.md` (239): fine

### If you already know: `coming-from/node-red.md` (368): light edit

1. **Known finding 4.** Add under Messages or Nodes: "A flow has one MQTT broker and one WiFi network, set on any
   MQTT or WiFi node. Node-RED's broker per node doesn't carry over." Link `working-in-the-editor.md#config-nodes`.
2. "Every message needs a `topic`, even an empty one" — **[Fact?]** verify against the compiler/runtime; the message
   shape on `flows-and-nodes.md` says only that `topic` is standard.
3. "`mqtt`, `http` and `udp` will look familiar" — use palette names: `mqtt publish`, `mqtt subscribe`,
   `http request`, `http in`, `udp send`, `udp receive`.
4. Stray double blank line after "Where the flow runs" and trailing spaces after "look familiar." (source only).

### If you already know: `coming-from/micropython.md` (324): fine

1. Point to the custom image for classic ESP32 owners, since "It doesn't replace your firmware" is no longer the
   advice for them: "On a classic ESP32 without PSRAM, the advised firmware is the [custom image]…".

### If you already know: `coming-from/arduino.md` (258): light edit

1. "What stays the same" holds one sentence about pin checking, which isn't something that stays the same. Rename
   "Pins are checked" or fold into "Python instead of C".
2. The paragraph break inside "Thingstudio checks your pin\nnumbers" leaves a short first line; rewrap.
3. "takes seconds" (Home 5).

### Getting started: `getting-started.md` (504): light edit

1. **Mike's remark 1:** remove "To install a specific version," from "To install a specific version, upgrade or
   remove Thingstudio, or build it from source, see Installation details."
2. Fine otherwise; the first-hour route reads cleanly.

### Getting started: `editor-tour.md` (567): light edit

1. C1: delete the opening sentence.
2. "Board type, pin map: the **Board** menu…" — the bullet names follow the picture's labels (by Mike's 2026-10-11
   call). Fine; check the picture still matches the toolbar after v0.11 (regenerate with `tools/screenshots.py`).

### Getting started: `installing-micropython.md` (969): light edit

Read whole with `custom-firmware.md` (known finding 5). Consistent on the advice; the issues are structure and labels.

1. The page says three times that the manual route is further down: "Doing it by hand is at the bottom of this
   page", "The rest of this page is the same job without the editor…", and "You don't need any of this… It is
   here for the rest." Keep one (the section heading plus its first sentence).
2. Step 4 carries four jobs (pick four fields, why hashes are pinned, which build for PSRAM/SOLO, the custom image).
   Split: step 4 "Pick **Chip family**, **Firmware**, **Build** and **Version**"; then a short "Which build" paragraph
   after the steps; the custom-image advice as its own paragraph before the steps, since it changes what the reader
   picks.
3. Use the dialog's labels **[Fact]**: Firmware is **Official MicroPython (micropython.org)** or **Thingstudio custom
   image**; builds are labelled "ESP32 with PSRAM (WROVER / SPIRAM)" and "ESP32 single-core (SOLO / UNICORE)", not
   "PSRAM (WROVER)" and "single-core".
4. "a build for a board we don't list" — "we"; "a board Thingstudio doesn't list".
5. "the usual reason a first install \"succeeds\" and then doesn't boot" — drop the scare quotes: "the usual reason a
   board doesn't boot after a successful install".
6. Step 1 tells every ESP32 user to hold BOOT and tap RESET; boards with a USB-serial chip usually don't need it (the
   manual section says so). "If the port doesn't appear in step 3, hold BOOT and tap RESET" reads in work order.

### Getting started: `connecting.md` (252): fine

### Getting started: `installing-runtime.md` (204): fine

1. Add known finding 2 here or in debugging (see Gaps, item 3): on the custom image, Install runtime writes only
   `main.py`.

### Getting started: `first-flow.md` (647): light edit

1. "Next, pick:" (C7). The paragraph under it ("Each version the function above could take holds the LED's state
   somewhere different: in the timer's count, on the hardware, or with `context`… A flow keeps state only where you
   put it…") is hard to follow before the reader has seen the other versions. Cut it; the tutorial says it.
2. "Set the console's **Show** menu to **Info** or **Debug** to see each stage, including the board's free memory."
   Fine, but link the Memory section once it explains the line (C6).
3. Mention the shipped example once ("`examples/blink.flow.json` is this flow") and say where it is (C5.6).
4. "If it doesn't blink": "Each symptom below has its own fix:" is filler (the rewrite log asked whether symptom lists
   need a lead-in). Fine to keep until the guide says otherwise.

### Getting started: `installation-details.md` (543): light edit

1. **Mike's remark 1:** delete "### Install a specific version" and its body (from "The installer script installs
   the latest release unless…" to "**Tools → Install runtime…** installs the matching one.").
2. **Structure [Fact-adjacent]:** the uninstall commands currently sit under that heading. Give them their own
   "### Remove" heading under Installer script, and add, for repeating a first install: "The uninstall leaves
   `~/.thingstudio` (credentials, presets, custom nodes, board files). To start again as a new user, move that folder
   aside as well." (Mike's remark 1; also useful to testers.)
3. "For a version other than the latest, open that release from the releases page" (Packages) can stay: it's the
   package route, not the env var.
4. Double blank line after the macOS notarization sentence (source only).
5. "From source" is developer material; by remark 4 it could move to the developer section with Check a flow.
   Editor's call: Getting started links to it.

### Tutorials: `tutorials/index.md` (153): rewrite

1. C4: delete "More are coming, in this order…". Keep the invitation to report, without the plan: "If you've built
   something past the tutorials, what worked and what stalled is a useful report: file it on the issue tracker."
2. "Two tutorials, each one starting from the flow the last one left you with" — the nav lists three under
   Tutorials. Once A sensor display is marked work in progress (remark 5), say so here or drop it from this list.
3. When the MQTT tutorial lands (Gaps, item 2), it becomes item 3.

### Tutorials: `tutorials/two-more-blinks.md` (696): light edit

1. C7 voice: "That works." "Lost it?" "and each way shows something different about Thingstudio" (cut). Replace
   dash asides with sentences.
2. The "An important point to understand" box is an essay: the two bullets argue a design position ("A crashed
   stateful component needs its data restored to an acceptable earlier version, with nothing to say which that
   is."). Cut to two sentences: "Each message is handled on its own; nothing carries over unless you store it. To
   remember between messages, use `context` (this node) or `flow` (the whole flow); see Context, flow and settings."
   Also "A flow is stateless" on the page that teaches state reads as a contradiction; the rewrite above avoids it.
3. "with `machine.Pin(15)` as the pin" in the download sentence: say to change 15 to the reader's LED pin.
4. "Making it the opposite of its old value needs the old value read, and `change`'s one rule doesn't do that — so a
   toggle stays in `context`." Rephrase: "A `change` node can store a flow variable but can't flip it, so a toggle
   needs a function node."
5. "Next, pick:" (C7).

### Tutorials: `tutorials/blink-from-your-network.md` (767): rewrite

1. **The flow is never built.** The page offers the download "if you're starting cold" but never tells a reader
   coming from Two more blinks to delete the timer, add `http in` (port 9999, path `/toggle`, method GET), a
   two-output function, `http response`, `wifi status` and a `debug` node, and wire them. Add a "Build the flow"
   section with numbered steps before "Name the board, then deploy", as `first-flow.md` does. Learner profile:
   Path-follower.
2. "tick **full message** on the `debug` node" — the reader has no debug node (see 1). Wire `wifi status` to a
   `debug` node in the build steps.
3. "First: the board joins WiFi" explains credentials before the steps; cut to one sentence plus the link
   (`thingstudio-folder.md#credentials`). Step 3 isn't an action ("The WiFi field … picks that credential"); fold
   it into step 2. Use the v0.11 form's words: **+** opens a form with a name, SSID and password, "Saved on this
   computer, not in the flow."
4. "The chain, and the reply" shows the code after deploy; it belongs in the build steps.
5. "One line on the open port" heading: "The server is open". "not just a web server" (last link) — "just".
6. C4: "Tutorials — what comes after the network: publish and subscribe over MQTT is next to be written." Delete.
7. Em-dash asides throughout (C7); "(they don't everywhere, and they don't across VPN tunnels at all — multicast
   doesn't pass)" → "`.local` names don't resolve on every network, and never across a VPN."

### Tutorials: `sensor-display.md` (1208): work-in-progress note only (Mike's remark 5)

Near-term change: a note at the top, e.g. `!!! note "Work in progress"` "This tutorial is being reworked. The
example flow runs, but some steps may not match the editor." Recorded for later, not to act on now:

1. "What you need" links Connecting over WiFi for the broker; that page is about the editor over WiFi. **[Fact]**
2. The finished flow ships in `examples/` (C5.6).
3. "The example flow also turns the pages every 8 seconds with a **gui navigator** node, which isn't in the palette."
   By remark 6, hidden nodes are left out: remove the sentence, and the navigator from the example or the example
   from the tutorial.
4. "A histograms shows" — typo.
5. It lives at the top level, not in `tutorials/`.
6. "pick your MQTT broker and WiFi" — fine with one broker per flow; say "the flow's broker".

### Building flows: `working-in-the-editor.md` (823): light edit

1. C1: delete the opening line (Mike asked for no intro on this page).
2. Config nodes: matches v0.11 (one broker per flow, one form with Save/Cancel, credential missing on this
   computer). Check the **+** form text against the editor: "Saved on this computer, not in the flow."
3. "A flow doesn't need a `wifi status` node to use the network." Good; keep.
4. **[Fact]** Node status lists the nodes with a status dot and leaves out `ntp`, which reports one
   (`runtime.report_status` in `ntp.ts`: waiting for WiFi, synced, failed). Add it, and check the rest of the list
   against the `report_status` callers.

### Building flows: `gui-layout.md` (483): merge into `nodes/gui.md` (Mike's remark 7)

1. Keep the substance (fixed panel, layout resolved at compile time, no reflow) as a short "How layout works"
   section at the top of gui.md's layout section. Cut the repetition: "Nothing on the board moves anything because
   the size changed, because the size never changes."; "Pages don't resize either…"; the web-framework comparison
   to two or three lines.
2. "That is what keeps a GUI flow affordable on a microcontroller" — a design defence (C2); cut.
3. Redirect: links from `faq.md`, `nodes/gui.md`, `sensor-display.md`; add a redirect or leave no dangling links
   (the strict build will catch them).

### Building flows: `flow-lifecycle.md` (666): rewrite second half

1. C1: delete the opening.
2. From "**The flow name** field…" onward the page is in the old voice: "you can type over that suggestion freely",
   "Useful for confirming what's actually on the board", "currently" ×3, unwrapped long lines. Rewrite to the guide.
3. **Structure:** the Check status and Disconnect paragraphs sit under "### Libraries". Give them a "## Board
   status and disconnecting" section, or move them to `connecting.md` / `debugging.md` where the reader uses them.
4. The deploy error list ("a compile error — …", "a space error — …") should link the debugging sections that
   explain each.
5. "Custom node packages and saved credentials live in…" repeats `thingstudio-folder.md`; one sentence and a link.

### Building flows: `thingstudio-folder.md` (438): light edit

1. **[Fact]** "The editor reads these folders through the Thingstudio backend, so they aren't available when the
   editor talks to the board directly over USB." The direct WebSerial mode is hidden in the editor
   (`connModeOptionDirect` is `hidden`). Delete the sentence.

### Boards and networks: `supported-hardware.md` (690): fine

1. "Yes, display only." — stray full stop in a table cell.
2. "a mounted drive for RP2040, RP2350 and nRF52 boards" — matches `firmware/builds.json` (one nRF52840 build, the
   XIAO). Fine.

### Boards and networks: `boards.md` (2131): light edit

1. Opening: "This page covers picking a board…" (C1). Then "Each board has a definition file, and so does each
   processor" repeats the first sentence. Start at "Thingstudio checks every pin in a flow…".
2. "Built-in boards" repeats Supported hardware's board list (one home). Keep only the pin notes column here, or
   merge the notes into Supported hardware and link.
3. "Your definition files" repeats `thingstudio-folder.md`'s "Boards and processors" nearly word for word. Keep it
   here (the topic's home) and cut the folder page to one line and a link, or the reverse.
4. "such as an ESP-NOW node on a Pico" — no ESP-NOW node is in the palette or the node reference. Use a
   real example (an MQTT node on a Pico without WiFi). Checked: no ESP-NOW node exists in
   `editor/src/node-library/core-packages/`, so **[Fact]**.
5. "The palette greys out" / "recognises" — US spelling (C2).
6. Long unwrapped lines (source only).

### Boards and networks: `custom-firmware.md` (1197): light edit

Read whole with `installing-micropython.md` (known finding 5).

1. C5.4: the second paragraph says the stock build is "what Installing MicroPython sets out". Replace with "On
   stock MicroPython, flows without a GUI run as usual; see Install MicroPython to go back."
2. The `MemoryError allocating 13317 bytes` sentence appears in the opening and again in "What it changes". Keep one.
3. The third paragraph ("The technique is not specific to this image… `firmware/classic-esp32/` … is a working
   example to copy") is developer material; move to the developer section or the end of the page.
4. "14.1.0 for the current image" and the memory table are figures that change (one home); say "the version in the
   dialog's Version list" and keep the table only if it explains which number matters (C6).
5. "Two habits avoid the limits that remain" and "Read the third row before leaning on deploys" — fold into the one
   Memory home (C6) and link.
6. "Back to stock MicroPython": "The stock flow of Installing MicroPython to Install the runtime covers both steps"
   — awkward; "Install MicroPython, then install the runtime."

### Boards and networks: `wifi-connection.md` (647): fine

1. "Good to know" is a weak heading: "Limits".

### Boards and networks: `wifi-provisioning.md` (354): light edit

1. C5.2: add where the reader meets it: "A flow with MQTT nodes can't use Unmanaged: MQTT needs the network in the
   flow." (Check the reason against the compile error.)

### Node reference: `nodes/index.md` (1209): light edit

1. C1: opening.
2. "Sends a frame to an SPI color display (ST7789)" and "(SSD1306)" — chip lists belong on Supported hardware (one
   home); ST7796 is also supported. Drop the parentheses.
3. `ntp`'s kind is "in and out", which isn't one of the three kinds the page defines. Say "transform (it also
   sends after each sync)", or note the exception under Kinds of node.
4. "Which node do I need?" is the most useful part of the page; move it to the top.

### Node reference: `nodes/inject.md` (132): rewrite

1. C3: add Wiring (**Output**: the fixed value as `payload`, `topic` '').
2. Behavior repeats the opening ("The '▶' icon and the rest of the node are two separate click targets") and runs
   five ideas into one paragraph. Split: clicking, live-only, no fire at start (use startup).

### Node reference: `nodes/startup.md` (241): fine

### Node reference: `nodes/timer.md` (74): light edit

1. "a heartbeat with a sequence number, not a repeated value" and "not a fixed constant" say the same thing twice.
   One-line purpose: "Sends a count, starting at 1, at a fixed interval."
2. C3: Wiring (**Output**: the count as `payload`).

### Node reference: `nodes/function.md` (309): light edit

1. "`outputCount` in the flow file" (C2): delete.
2. "return an array" — Python calls it a list.
3. Missing for the reader: don't block (link `background/event-driven.md#the-one-rule-dont-block`), `await` is
   allowed, imports work, `runtime.shared()`, and an `## Errors` section (`[NODE_ERROR]`, compile-time syntax errors
   highlighted on the node). The page is a key reference and is thin compared with what other pages say about it.
4. "colour scheme" (C2).

### Node reference: `nodes/change.md` (223): light edit

1. C3: Wiring.
2. Fine otherwise; the example is good.

### Node reference: `nodes/delay.md` (105): light edit

1. "so it pays to know this up front" (C2). Bold sentence plus explanation is fine; keep the fact.
2. C3: Wiring.

### Node reference: `nodes/filter.md` (268): light edit

1. C3: Wiring and Errors (the non-number error, the 32-topic reset message).

### Node reference: `nodes/journal.md` (451): light edit

1. "the way RRDtool and Cacti do" — fine for the reader set.
2. Errors in Behavior: move to `## Errors`.
3. "`examples/gui-headliner-sensor-freenove-s3-4in.flow.json` does this" — an example pointer on a node page (the
   2026-10-11 rewrite removed these elsewhere). Remove, or keep as a link to the tutorial.

### Node reference: `nodes/debug.md` (79): light edit

1. "the way to see what's actually flowing through a wire" and "Use it to see a value flowing through a wire
   without guessing" — the same idea twice, chatty. One-line purpose: "Prints a message's payload to the editor's
   console."
2. "device's serial console" — the console shows over WiFi too; "the editor's console".
3. C3: Wiring (**Input**: any message).

### Node reference: `nodes/wifi-status.md` (344): rewrite

1. Long, unwrapped paragraphs with nested asides ("— RSSI is an ESP32-only reading, not available on every
   board"). Split into Wiring (the message fields as a table: `payload`, `ip`, `subnet`, `gateway`, `dns`, `rssi`)
   and Behavior (when it sends).
2. "learn its credentials on its own over the air" — the phrase Mike rejected on 2026-10-11. "leave the network out
   of the flow and enter it on the board (WiFi provisioning)".
3. "wifi_status" (C2).
4. "In a flow with MQTT nodes, MQTT manages the WiFi connection and this node only reports on it." Fine; keep.

### Node reference: `nodes/wifi-gate.md` (269): rewrite

1. Four paragraphs for one idea. Behavior repeats the opening and the WiFi field sentence (C2). Cut to: what it
   checks (the live link, not `wifi status`'s last message), what it doesn't (broker or server reachability), and
   when to use it.
2. "A `transform`, like `function` or `delay` — one input, one output…" — the kind is on the index; cut.

### Node reference: `nodes/ntp.md` (393): fine

1. Checked: the `unix` example (1791983109) matches 2026-10-14 14:05:09 +01:00.

### Node reference: `nodes/udp-receive.md` (106): light edit

1. "internal receive polling cadence… rarely needs changing" (C2).
2. C3: Wiring (**Output**: `payload` bytes, `host`, `port`).
3. WiFi sentence twice (C2).

### Node reference: `nodes/mqtt-subscribe.md` (332): light edit

1. Link the MQTT troubleshooting entry (Gaps, item 1) under Errors.
2. "an `unsubscribe` for it takes effect until the next reload" — unclear. "lasts until the flow restarts".
3. "Uses the flow's WiFi network and broker config, same as **mqtt publish**. An 'unmanaged' WiFi config isn't
   accepted here, for the same reason." — the reason is on another page; state it.
4. C3: Wiring (the message fields: `payload`, `topic`, `retain`), Errors (dynamic-subscription errors).
5. "This is usually not an issue, but…" (C2).

### Node reference: `nodes/http-request.md` (294): rewrite

1. One 120-word paragraph of limitations ("A few real limitations worth knowing…"). Per the guide's Limitations
   rule, state each where the reader meets it: HTTPS under **url** (already there), redirects and chunked encoding
   under Behavior, the memory limit under Errors with what to do.
2. C3: Wiring (**Input**: any message; for POST, `payload` is the body. **Output**: `payload` body, `status`).
3. "shows in the debug log" — the console.
4. WiFi sentence twice.

### Node reference: `nodes/http-in.md` (326): light edit

1. "a `POST`/`PUT` body" — **[Fact]** the node takes GET or POST only (its method property). Drop PUT.
2. "Limitations" is a list of what's missing (guide: Limitations). Move each to where it applies (path,
   payload) and drop the heading, or keep with "what to do instead" per item.
3. "rather than hanging the client forever", "actually answer" (C2).
4. C3: Wiring.

### Node reference: `nodes/http-response.md` (129): light edit

1. "Properties: None — everything comes off the message" — move `statusCode` and `payload` to Wiring (**Input**).
2. "raises a clear error rather than failing silently" (C2).

### Node reference: `nodes/udp-send.md` (128): light edit

1. "raises a clear error naming the host and port… not a bare error code" (C2) → Errors: "A failed send names the
   host and port."
2. C3: Wiring. WiFi sentence twice.

### Node reference: `nodes/mqtt-publish.md` (229): light edit

1. Link the MQTT troubleshooting entry (Gaps, item 1).
2. **[Fact]** The node has a **WiFi** field (`wifiConfigId` in `mqtt-publish.ts`, with help text "One WiFi network
   per flow…"), but Properties doesn't list it. Add it, as on the other network pages, and cut the parenthesis in
   Behavior. Same on `mqtt-subscribe.md`.
3. "Nodes on the same broker share one connection" — with one broker per flow, "MQTT nodes share one connection".
4. "actually" (C2). C3: Wiring.

### Node reference: `nodes/interrupt.md` (115): light edit

1. "— genuinely event-driven, not polled" (C2). C3: Wiring.

### Node reference: `nodes/eswitch.md` (193): light edit

1. "Default 4" for the pin is real (`eswitch.ts`); fine.
2. The pull paragraph repeats the **pull** property. Cut.
3. C3: the message block is Wiring.

### Node reference: `nodes/ebutton.md` (335): light edit

1. Delete "— e.g. most of an EMF 2022 TiDAL badge's buttons" (C2, history).
2. The suppress behavior is told twice (property and Behavior). Keep one.

### Node reference: `nodes/adc.md` (240): fine

### Node reference: `nodes/encoder.md` (180): fine

### Node reference: `nodes/neopixel.md` (183): fine

1. "colour" in prose (C2). The payload key really is `'colour'` (`neopixel.ts`); keep it in the example.

### Node reference: `nodes/gpio-out.md` (69): light edit

1. C3: Wiring (**Input**: any; truthy sets high).

### Node reference: `nodes/pwm-out.md` (85): light edit

1. "a slightly-out-of-bounds computed value won't crash the flow" (C2). C3: Wiring.

### Node reference: `nodes/display-spi.md` (1173): light edit

1. C5.5: `palette` twice in Properties. Merge into one entry (the swatches, and that a themed gui screen supplies
   it).
2. "xstart / ystart — the panel's offset into the ST7789 controller's own…" — a chip-specific detail inside a
   property; fine, but "flow-boot time" (C2) → "when the flow starts".
3. "raises a clear error rather than silently desyncing the panel" (C2).
4. "the byte-order gotcha" → "byte-order problem".
5. "colours" (C2).

### Node reference: `nodes/display-i2c.md` (350): light edit

1. "A flow saved before I2C buses existed…" (C2, history): delete.
2. "`addr` in the flow file, as a plain number" (C2): delete the internal name; keep "`60` is `0x3C`".
3. "Only I2C wiring is supported — an SSD1306 wired over SPI isn't covered by this node." Fine as a limit; add what
   to do instead (a function node driving SPI, or none).
4. The preset paragraph before Properties: one line ("Has a preset menu; see Presets.").

### Node reference: `nodes/bme280.md` (181): fine

### Node reference: `nodes/touch-i2c.md` (293): fine

### Node reference: `nodes/i2c.md` (203): fine

### Node reference: `nodes/i2c-bus.md` (172): fine

### Node reference: `nodes/touch-panel.md` (356): fine

1. Freenove values inline in a reference page ("Freenove: 18") are fine as examples; once a preset ships, point at
   it instead.

### Node reference: `nodes/gui.md` (2277): rewrite

1. **Mike's remark 6:** remove `gui navigator` from "The nodes", and remove "## Modals in the flow file" and the
   modal's pointer to it. `gui navigator` is `hidden: true` in `gui.ts`. `gui modal` is in the palette, but its
   layout can only be written by editing the flow file, so by the same remark it is left out too (or reduced to one
   line saying it isn't laid out in the editor). Mike to confirm which.
2. **Mike's remark 7:** merge `gui-layout.md` here (see that page).
3. C5.3: one layout model and one label (cell grid vs row/column tree; **panel** vs **card**). Check the editor.
4. Order follows the work: Laying out pages is the main task and comes last. Order: the nodes; laying out pages
   (with the merged layout model); buttons; histogram; themes and color; rotating; fonts.
5. "## Color" is broken: "White text, gray for stale values, and a green accent…" is a fragment. Fold into Themes.
6. "An older flow may still use a shared **GUI theme** config" (C2, history). "Vivid is the card demo's scheme"
   (internal). "It's the cheapest way to make a page read as groups" (C2).
7. "On a classic ESP32 without PSRAM, a GUI flow needs the custom firmware" — good; keep.

### Extending and automating: `node-conventions.md` (381): light edit

1. **[Fact]** C5.1: "A custom node has one input and one output" and "there are no event-driven custom sources" are
   wrong; `custom-nodes.md` documents event sources, run-once sources, several outputs and two-faced nodes. Fix
   Ports, Kind and Limits to match.
2. Opening: "These are the rules a custom node follows; the file format itself is in…" — fine.

### Extending and automating: `custom-nodes.md` (2816): light edit

1. Title "Writing a custom node for Thingstudio" vs nav "Writing custom nodes"; use the nav's.
2. Mixed source formatting (70-column wrap in the first half, 120 in the second) shows two authors; the prose in
   "Errors" ("errors out naming that node") is old voice. Voice pass.
3. "placed in the backend's `~/.thingstudio/custom-nodes/` directory" — "the backend's" is internal.
4. Long; a reference for developers, so length is less of a problem than on task pages. Consider moving the
   compile-hook section to the developer section with remark 4.

### Extending and automating: `ai-authoring.md`: facts only

1. Known finding 4 (`brokerConfigId` implying a broker per node) appears already fixed: no `brokerConfigId`
   example remains; line 55 names the configs generically. Re-check when the page is next edited.

### Extending and automating: `check-a-flow.md` (560): move (Mike's remark 4)

1. Move to the developer section. Its first line should say it needs a copy of the repository and Node 22.
2. Content otherwise fine.

### Extending and automating: `command-line.md` (446): split (Mike's remark 4)

1. "Starting options" is for every user: keep in the user manual (Installation details or a short page).
2. "Installing the runtime from the command line" and "Deploy and run a flow without the editor" use
   `test-flows/` scripts from a source checkout: move to the developer section.
3. The opening ("…and a check for a flow file. To check a flow file from the command line, see…") contradicts
   itself; goes away with the split.
4. "`device_cli.py` is a small command line" — sizing word.

### Extending and automating: `nodes-catalog.md`: facts only

1. Current: `editor/test/cli-describe.test.ts` passes.

### Troubleshooting: `debugging.md` (2854): light edit, plus the gaps

1. **Known finding 4 [Fact]:** "a Thingstudio image carries one but not the boot script" → "the Thingstudio custom
   image carries one but not the boot script", the dialog's label.
2. C6: rewrite "### Memory" as the one home for the `[memory]` line (known finding 3); remove the sentence that
   invites blaming the ESP-IDF figure. Cut the repeats between "MemoryError or a library that won't load" and
   "Restarting the board": the "soft restart doesn't help" explanation once, the recipe once.
3. C2: "Deploy does not try to fix this for you: …" paragraph; "That is a limit of the board, not a fault in the
   flow"; "Nothing in the editor can make room that the board does not have"; "That is normal now and then".
4. Install firmware table: "Pick **Image file**" **[Fact]** → the dialog's label is "Or use your own image file".
   "catalogue" (C2); "yet" in "no pinned image for that family yet" (current state only).
5. "## Native code (Tools → Native code)" is a tool section among symptom sections. Rename to the symptom ("Deploy
   fails with an architecture error").
6. Gaps 1 and 3 go here.

### Troubleshooting: `faq.md` (1986): light edit

1. C4: delete "See the deferred note on modem sleep in `working-notes/outstanding-items.md`."
2. C6: seven memory questions overlap debugging. Keep one-paragraph answers that link the Memory home; drop "Why
   doesn't Deploy clear the old flow…" (a design defence and history) and "Why is Deploy sending the flow in
   pieces?" (internal).
3. No grouping: 30 questions in no order. Group under headings in the reader's work order: Installing, Connecting,
   Building flows, Deploying, Memory, Network, Display and touch, Boards.
4. "Why does http request fail with MemoryError": three blank lines after the heading (source only).
5. "Measured on a classic ESP32 (Wemos D1 R32) toggling an LED, through a VPN tunnel: 0.16–1.2 s…" — test-log
   detail; one sentence is enough.
6. "## How do I tell which version…" says **Help → About**; the item is **Help → About Thingstudio**
   (`debugging.md` has it right). **[Fact]**

## Gaps

1. **"MQTT broker unreachable" in `debugging.md`** (known finding 1; Mike's remarks 2 and 3). Symptom: the console
   line `mqtt connect to HOST:1883 failed after 3 attempts (… 'Timeout on socket write' …, wifi status 1010)`, and the
   node's red dot. Meaning: the board is on WiFi but can't reach the broker from its network. Causes: board on a
   phone hotspot, broker on the home LAN (the laptop may reach it over a VPN the board doesn't have); a mobile network
   dropping port 1883; Mosquitto 2 listening only on localhost (needs `listener 1883` and `allow_anonymous true`, or a
   password file). What to try: put the board on the broker's network; use `test.mosquitto.org` with a unique topic
   (public: anyone can read it); a relay on the laptop (`ssh -g -N -L 0.0.0.0:1883:<broker>:1883 localhost` with
   Remote Login on). Link it from both MQTT node pages and from the plainer console line once it exists (outstanding
   item, remark 2).
2. **Tutorial 3: publish and subscribe over MQTT** (Mike's remark 3). Uses `test.mosquitto.org` by default, with a
   topic made unique by a random number, says plainly that the broker is public, and offers a local broker as the
   alternative. Sits after Blink from your network; links Gap 1 for "nothing arrives".
3. **"Did I install the runtime by accident?"** (known finding 2) in `debugging.md` or `installing-runtime.md`: on
   the custom image, Install runtime writes only `main.py`; a full runtime on the filesystem comes from flashing
   without **Erase all flash first** over an older install; check with `import os; print(os.listdir('/'))` in the
   command box.
4. **Where the examples are** (C5.6): one sentence in Installation details (per install route) and the link from
   Home and Blink an LED.
5. **A developer section** (Mike's remark 4): Check a flow, the source-checkout half of Command line, From source,
   custom-firmware's "freeze your own" paragraph, and possibly custom-nodes' compile hooks. Placed after Extending
   in the nav.
6. **Pictures** (known finding 6): labelled screenshots of the broker edit form and the Install firmware dialog
   (`tools/screenshots.py` takes only the editor overview today). Where words were weakest for the tester.
7. **One place for the console's levels.** Which level each kind of line needs is said on several pages
   (editor tour, debugging, first flow, connecting). Debugging's list is the home; the others link it. (Also a rule
   candidate for the guide, raised on 2026-10-11.)

## Suggested order of work

1. **First hour, quick fixes (one session):** Installation details (remark 1, remove heading slip, the reset note);
   Getting started (drop the pointer); Installing MicroPython (labels, the three "further down" lines, step 4 split);
   Editor tour and Editor in depth openings; Blink an LED ("Next, pick:", the state paragraph, the example's
   location); custom firmware contradiction and repeat; `debugging.md` "a Thingstudio image" and "Image file".
2. **What the tester hits next:** Gap 1 (MQTT unreachable) with links from both MQTT pages; C6 memory home in
   debugging and the FAQ trims; Gap 3; Known finding 4 on `coming-from/node-red.md`; WiFi provisioning's MQTT line.
3. **Tutorials:** rewrite Blink from your network with build steps; voice pass on Two more blinks; Tutorials index
   (no plans; sensor display marked work in progress per remark 5, and its note added); then Gap 2 (MQTT tutorial).
4. **Contradictions:** node-conventions vs custom-nodes; gui.md layout model and remarks 6 and 7 (merge gui-layout,
   drop navigator and modal JSON); display-spi's double palette.
5. **Node pages to layout and voice (C2, C3):** network pages first (wifi status, wifi gate, http request, http in,
   http response, udp, mqtt), then general (inject, timer, debug, delay, function), then hardware.
6. **Structure:** developer section (remark 4, Gap 5); FAQ grouping; flow-lifecycle's second half; boards.md
   duplication with Supported hardware and the folder page.
7. **Pictures** (Gap 6), with `tools/screenshots.py`, once the forms are settled.

## Checks run

- `mkdocs build --strict -d <out>` in a cloud clone (venv from `docs/requirements.txt`): exit 0, no warnings.
- Internal link check over the built site (every `href`, page and anchor, working notes excluded): no broken links.
  The only hits were `404.html`'s root-relative links, which resolve on the served site.
- Editor doc links: every `path:` in `editor/src/app/*.ts` and every `"page/#anchor"` string in `editor/src`
  resolves, including `DOC_INSTALL_MICROPYTHON`, `DOC_BOARD_WONT_CONNECT`, `DOC_BOARD_STUCK`, `DOC_COMMANDS`,
  `DOC_BOARD_FIRMWARE_MODULES` (`board-diagnosis.ts`) and `debugging/#memoryerror-or-a-library-that-wont-load`.
- `npx vitest run test/firmware-assets.test.ts test/cli-describe.test.ts` (after `npm ci --ignore-scripts`):
  2 files, 15 tests passed.
- Word counts, `wc -w`, 2026-11-01 (44,130 total including `ai-authoring.md` 2781 and `nodes-catalog.md` 3141).
  Longest hand-written pages: `debugging.md` 2854, `custom-nodes.md` 2816, `nodes/gui.md` 2277, `boards.md` 2131,
  `faq.md` 1986, `nodes/index.md` 1209, `sensor-display.md` 1208, `custom-firmware.md` 1197, `nodes/display-spi.md`
  1173, `index.md` 1106. Shortest: `nodes/gpio-out.md` 69, `nodes/timer.md` 74, `nodes/debug.md` 79. Length is the
  problem on `debugging.md`, `faq.md` and `gui.md` (repetition, C6), not on `custom-nodes.md` (developer reference).
  Per-page counts are on each page heading above.
- Not run: checks against a running editor (labels were read from `editor/index.html` and `editor/src`); the
  screenshot regeneration.
