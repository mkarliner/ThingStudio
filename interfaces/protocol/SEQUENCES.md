# Wire protocol — exchanges, as sequence diagrams

`SPEC.md` says what each message looks like. This file shows **how they are used together**: who sends
what, what answers it, and what happens when something goes wrong. It describes what the code does today
(editor `editor/src/app/main.ts`, board `device-runtime/src/listener.py`, backend
`backend/src/thingstudio_backend/{ws_relay,tcp_relay}.py`), including its known faults. Those are marked
**⚠** and numbered after the findings in the latest protocol audit
(`docs/working-notes/reviews/2026-10-24-protocol-audit.md`).

The diagrams are Mermaid and render on GitHub and in VS Code's Markdown preview.

**Keeping this current.** `tools/protocol_coverage.py` (run by `make test`) fails if a message in
`messages.json` appears in no diagram here, or a diagram names a message that doesn't exist. It cannot tell
whether a diagram is *right*. When you change an exchange, change its diagram in the same commit. The
convention the check relies on: on an arrow line, an **unquoted ALL-CAPS first word is a message name**
(`E->>B: FLOW_PUT offset, data`). Anything that isn't a protocol message (backend JSON, the WiFi
handshake's text lines, printed console lines) starts with a quote or lower case.

Participants: **Editor** (the browser app), **Backend** (the local relay, only when connected through it),
**Board** (the listener on the device). The backend moves frames verbatim and never decodes them, so most
diagrams leave it out: an arrow straight from Editor to Board passes through it unchanged.

Contents:

1. [Connect over USB](#1-connect-over-usb)
2. [Connect over WiFi](#2-connect-over-wifi)
3. [Deploy a flow — the normal path](#3-deploy-a-flow--the-normal-path)
4. [Deploy a flow — when a piece goes wrong](#4-deploy-a-flow--when-a-piece-goes-wrong)
5. [Deploy a flow — when the commit fails](#5-deploy-a-flow--when-the-commit-fails)
6. [Install a library](#6-install-a-library)
7. [Change board settings](#7-change-board-settings)
8. [Commands with no reply](#8-commands-with-no-reply)
9. [Things the board says unasked](#9-things-the-board-says-unasked)
10. [Old and reserved messages](#10-old-and-reserved-messages)

---

## 1. Connect over USB

The board sends a `HELLO` when its listener starts, but the editor has usually not connected yet, so on
Connect the editor always asks for one. No reply within 3 s doesn't stop Connect; the editor works out
from what the board did print what is probably wrong.

```mermaid
sequenceDiagram
    participant E as Editor
    participant BE as Backend
    participant B as Board
    E->>BE: "connect" port, baudrate (JSON text)
    BE->>B: opens the serial port
    BE-->>E: "status" connected
    E->>B: HELLO_REQUEST
    alt the runtime is running
        B-->>E: HELLO chip, runtime version, flow running, free memory, libraries
        Note over E: Version check. A different MAJOR version<br/>blocks Deploy. Minor/patch: logged only.
    else no HELLO within 3 s
        Note over E: Reads what the board printed instead:<br/>nothing = no MicroPython, an echoed<br/>SyntaxError = MicroPython but no runtime.<br/>Says what to do. Stays connected.
    end
```

Direct WebSerial (no backend) is the same without the backend's two steps.

## 2. Connect over WiFi

Only through the backend. The board speaks first, with a challenge; the password never crosses the
network. One WiFi session at a time. USB stays live alongside it.

```mermaid
sequenceDiagram
    participant E as Editor
    participant BE as Backend
    participant B as Board
    E->>BE: "connect" host, port, password if just typed
    BE->>B: "TCP connect" (gives up after 8 s)
    alt the board has a password set and no session open
        B-->>BE: "TSAUTH1 hostname nonce salt iterations"
        BE->>B: "TSAUTH1 hmac" (key from the saved password)
        alt right password
            B-->>BE: "TSAUTH OK"
            BE-->>E: "status" connected, network
            B-->>E: HELLO (sent at every session start)
            loop every 30 s
                BE->>B: "blank line" (keepalive)
            end
            Note over B: 90 s with no bytes at all:<br/>the board closes the session.
        else wrong password
            Note over B: waits 1 s (slows guessing)
            B-->>BE: "TSAUTH FAIL", then closes
            BE-->>E: "status" error, code says which
        end
    else another WiFi session is already open
        B-->>BE: "TSAUTH BUSY", then closes
    else no password set on the board
        B-->>BE: "TSAUTH NOPASSWORD", then closes
        Note over E: WiFi needs a password. Set one over USB (section 7).
    end
```

⚠ **Finding 5.** Everything the board sends goes to USB *and* to the WiFi session. Replies carry no request
id, so an editor on USB and one on WiFi each see the other's replies, and the `HELLO` sent when a WiFi
session starts can land in the middle of the other editor's deploy.

## 3. Deploy a flow — the normal path

The editor sends the flow in 5 KB pieces, each answered, then a commit. The board writes pieces to a
temporary file, so a big flow never needs one big block of memory.

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    Note over E: Version gate: refuses on a major mismatch,<br/>but only if a HELLO was seen this connection.<br/>None seen: deploys without checking (finding 9).
    Note over E: Compiles the flow to bytecode.
    opt the flow imports libraries
        Note over E,B: Install any the board lacks first (section 6).<br/>A failure there stops the deploy, flow unchanged.
    end
    loop each 5 KB piece: offset 0, 5120, 10240 ...
        E->>B: FLOW_PUT offset, total, data
        Note over B: writes the piece into /_flow.mpy.tmp
        B-->>E: FLOW_ACK offset, ok
    end
    E->>B: FLOW_COMMIT total, flowName, deployId, libraries needed
    Note over B: 1. checks all bytes arrived<br/>2. renames .tmp to /_flow.mpy<br/>3. checks the libraries are on the board<br/>4. stops the running flow<br/>5. saves name and deployId, imports the new flow<br/>6. removes libraries the new flow doesn't use
    alt the flow started
        B-->>E: DEPLOY_ACK free flash, free RAM
        Note over E: "deploy OK"
    else the board crashed while starting it (a hard fault, not an exception)
        B-->>E: HELLO (after the reboot)
        Note over E: Compares HELLO's deployId with this deploy's:<br/>same = running now, else not running.
    end
```

The editor waits up to 30 s for the answer to the commit.

## 4. Deploy a flow — when a piece goes wrong

Each piece gets up to three tries. What happens depends on why the editor didn't get an `ok`.

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    E->>B: FLOW_PUT offset N
    alt the line reached the board damaged (lost bytes on a USB-UART)
        Note over B: can't decode it, stores nothing
        B-->>E: FLOW_ACK offset N, ok false, code Garbled
        E->>B: FLOW_PUT offset N (resent, up to 2 more times)
        B-->>E: FLOW_ACK offset N, ok
    else the board stored the piece, but its FLOW_ACK was lost
        Note over E: no answer in 10 s
        E->>B: FLOW_PUT offset N (resent)
        Note over B: ⚠ Finding 1: already has piece N,<br/>expects the next one
        B-->>E: FLOW_ACK offset N, ok false, code BadPiece
        Note over E: treats BadPiece as final: deploy failed
        Note over B: ⚠ still expects the next piece. Every later deploy<br/>starts at offset 0 and is refused the same<br/>way, until the board restarts.
    else any other refusal (WriteFailed, BadPiece)
        B-->>E: FLOW_ACK offset N, ok false, code, error
        Note over E: final: deploy failed, reported once
    end
```

## 5. Deploy a flow — when the commit fails

The board answers a commit with exactly one `DEPLOY_ACK` or `DEPLOY_ERROR`. The editor reports the
error once, with advice. Nothing is retried, and the board never frees memory or restarts by itself to make a
retry fit.

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    E->>B: FLOW_COMMIT total, flowName, deployId, libraries
    alt fewer bytes arrived than total
        B-->>E: DEPLOY_ERROR Incomplete
        Note over B: old flow keeps running, untouched
    else a library the flow needs is missing
        Note over B: ⚠ Finding 3: the new flow file has<br/>ALREADY replaced the old one on flash
        B-->>E: DEPLOY_ERROR MissingDependency
        Note over B: old flow keeps running in memory and HELLO<br/>names it, but after a reset the board loads<br/>the refused flow, fails, and runs nothing
        Note over E: forgets what libraries the board has,<br/>so the next Deploy sends them all
    else the new flow raises while starting
        Note over B: old flow already stopped
        B-->>E: DEPLOY_ERROR ImportError / MemoryError / ...
        Note over B: no flow running now
        Note over E: advice for ImportError and MemoryError
    end
```

There is one more way to get a `DEPLOY_ERROR`, while pieces are still being sent: a piece the board has no
memory to decode.

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    Note over E: arms its wait for DEPLOY_ACK or DEPLOY_ERROR<br/>BEFORE sending the first piece
    E->>B: FLOW_PUT offset N
    Note over B: MemoryError decoding the line
    B-->>E: FLOW_ACK offset N, ok false, code Garbled
    B-->>E: DEPLOY_ERROR MemoryError
    Note over E: ⚠ Finding 4: the DEPLOY_ERROR fills<br/>the commit's wait. The Garbled ack resends the piece.
    E->>B: FLOW_PUT offset N (resent, now fits)
    B-->>E: FLOW_ACK offset N, ok
    E->>B: FLOW_COMMIT
    Note over E: reports "deploy failed: MemoryError"<br/>straight away, from the old answer
    B-->>E: DEPLOY_ACK (logged, nobody waiting for it)
    Note over B: the new flow is running
```

## 6. Install a library

Before a flow that imports libraries is deployed, the editor compares each library's hash with the list the
board gave in `HELLO` and sends only the missing or changed ones. Same pattern as a flow: 5 KB pieces, each
answered, then a commit.

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    opt no HELLO seen yet this connection
        E->>B: HELLO_REQUEST
        B-->>E: HELLO ... libraries name to hash
    end
    loop each library the board lacks
        loop each 5 KB piece of each file
            E->>B: DEP_PUT name, file, offset, total, data
            Note over B: writes into /lib/file.tmp
            B-->>E: DEP_ACK name, file, offset, ok
        end
        E->>B: DEP_COMMIT name, hash, files and sizes
        Note over B: checks sizes, renames .tmp files into place,<br/>updates its library index
        B-->>E: DEP_RESULT name, ok, free flash
    end
    Note over E: then the flow itself (section 3), with the<br/>libraries' hashes in FLOW_COMMIT
```

What goes wrong:

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    E->>B: DEP_PUT name L, offset N
    alt the board stored it but the DEP_ACK was lost
        Note over E: no answer in 10 s
        E->>B: DEP_PUT name L, offset N (resent)
        Note over B: ⚠ Finding 2: expects more bytes than N,<br/>refuses, and remembers library L as failed
        B-->>E: DEP_ACK name L, ok false, code BadPiece
        Note over E: deploy failed, and it sends no DEP_COMMIT
        Note over B: ⚠ L stays "failed" until a DEP_COMMIT for L.<br/>Every later deploy that needs L gets the<br/>same refusal at its first piece, until a restart.
    else the line reached the board damaged
        Note over B: decodes nothing. Remembers the decode error<br/>for the next failed DEP_COMMIT. Sends a FLOW_ACK<br/>Garbled (meant for flow pieces, ignored here).
        Note over E: no DEP_ACK in 10 s: resends the piece,<br/>which the board accepts
    else no room on flash, bad name
        B-->>E: DEP_ACK name L, ok false, code NoSpace / BadName
        Note over E: deploy failed, flow unchanged
    end
    E->>B: DEP_COMMIT name L
    alt a piece is missing or the sizes don't match
        B-->>E: DEP_RESULT name L, ok false, code Incomplete
        Note over B: deletes the .tmp files
    end
```

## 7. Change board settings

Hostname and WiFi password. **USB only**: the password is what makes a WiFi session trusted, so it can't be
changed over WiFi.

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    E->>B: SET_BOARD_SETTINGS hostname, password, clearPassword
    alt arrived over USB and valid
        Note over B: saves them, restarts its WiFi listener
        B-->>E: BOARD_SETTINGS_RESULT ok
        B-->>E: HELLO (new hostname, authRequired)
        Note over E: saves the password on this computer<br/>under the board's name
    else arrived over WiFi
        B-->>E: BOARD_SETTINGS_RESULT ok false, "only over USB"
    else invalid (password not 8-64 characters, bad hostname)
        B-->>E: BOARD_SETTINGS_RESULT ok false, error
    end
    Note over E: no answer in 10 s: "is it still connected?"
```

## 8. Commands with no reply

These four have no answering message. What the editor sees is what the board prints, or the `HELLO` after a
restart.

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    E->>B: TRIGGER nodeId
    Note over B: fires that inject node once.<br/>Unknown nodeId: logged, nothing else.
    E->>B: EXEC code
    Note over B: runs it inside the listener (the flow pauses<br/>until it finishes) and prints the result<br/>or the traceback as plain console lines
    B-->>E: "printed lines"
    E->>B: RESTART hard false / true
    Note over B: stops the flow (its cleanups run),<br/>then soft reset (interpreter) or hard reset (chip)
    B-->>E: HELLO (from the boot, if the port survived)
    Note over E: Deploy off until a HELLO arrives (up to 20 s),<br/>then asks once with HELLO_REQUEST
    E->>B: STOP_TO_PROMPT
    Note over B: stops the flow and the listener,<br/>leaves MicroPython's prompt on the serial line
    B-->>E: "printed LISTENER_STOPPED"
    Note over E: Deploy off. Commands now go to the prompt<br/>as raw text (backend "raw_write").<br/>"Restart Thingstudio" sends Ctrl-D.
```

`STOP_TO_PROMPT` is also sent before Install runtime and Remove flow, so the board lets go of the port.

## 9. Things the board says unasked

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    B-->>E: HELLO (at boot, and at each WiFi session start)
    B-->>E: NODE_ERROR nodeId, exception type, message
    Note over E: highlights that node in red
    B-->>E: NODE_STATUS nodeId, state, text
    Note over E: sets that node's status dot
    B-->>E: "printed lines" (debug node output, LISTENER_ messages)
    Note over E: shown in the console as plain text
    Note over B: Any line it can't read, from anyone, including<br/>a message type it doesn't know (finding 6):
    B-->>E: FLOW_ACK offset next expected, ok false, code Garbled
    Note over E: ignored unless a flow piece at that<br/>offset is waiting for an answer
```

## 10. Old and reserved messages

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    Note over E,B: Whole-flow deploy, for editors before 11.3.0. This<br/>editor never sends it. The board still accepts it.
    E->>B: DEPLOY bytecode, flowName, deployId, libraries
    B-->>E: DEPLOY_ACK or DEPLOY_ERROR (as in section 5)
    Note over E,B: Reserved: the id is kept, nothing uses it.
    B-->>E: VALUE_STREAM (never sent, decided not to build)
    E->>B: STATE_READ (board logs "not yet implemented")
    E->>B: STATE_WRITE (board logs "not yet implemented")
```
