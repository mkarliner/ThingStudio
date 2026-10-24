# Wire protocol — exchanges, as diagrams

`SPEC.md` §7 sets the rules for how messages are used together. This file draws them: who sends what, what
answers it, and what happens when something goes wrong. It shows what the code does (editor
`editor/src/protocol/transfer.ts` and `editor/src/app/main.ts`, board `device-runtime/src/listener.py` and
`statemachine.py`, backend `backend/src/thingstudio_backend/{ws_relay,tcp_relay}.py`). Where these diagrams and
`states.json` (the state machines, drawn in `STATES.md`) disagree, the table is right and the diagram is a bug.
The one known limit still open is marked **⚠**.

The diagrams are Mermaid and render on GitHub and in VS Code's Markdown preview.

**Keeping this current.** `tools/protocol_coverage.py` (run by `make test`) fails if a message in
`messages.json` appears in no diagram here, or a diagram names a message that doesn't exist. It can't tell
whether a diagram is *right*: the exchange vectors (`vectors/exchanges.json`) check the behaviour, and this file
should match them. When you change an exchange, change its diagram in the same commit. The convention the
check relies on: on an arrow line, an **unquoted ALL-CAPS first word is a message name**
(`E->>B: FLOW_PUT offset, data`). Anything that isn't a protocol message (backend JSON, the WiFi handshake's
text lines, printed console lines) starts with a quote or lower case.

Participants: **Editor** (the browser app), **Backend** (the local relay, only when connected through it),
**Board** (the listener on the device). The backend moves frames verbatim and never decodes them, so most
diagrams leave it out: an arrow straight from Editor to Board passes through it unchanged.

Contents:

1. [Connect over USB](#1-connect-over-usb)
2. [Connect over WiFi](#2-connect-over-wifi)
3. [A file arriving in pieces: the state machine](#3-a-file-arriving-in-pieces-the-state-machine)
4. [Deploy a flow](#4-deploy-a-flow)
5. [Deploy a flow — when a piece goes wrong](#5-deploy-a-flow--when-a-piece-goes-wrong)
6. [Deploy a flow — when the commit fails](#6-deploy-a-flow--when-the-commit-fails)
7. [Install a library](#7-install-a-library)
8. [Change board settings](#8-change-board-settings)
9. [Commands with no reply](#9-commands-with-no-reply)
10. [Things the board says unasked](#10-things-the-board-says-unasked)
11. [Old and reserved messages](#11-old-and-reserved-messages)

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
        Note over E: WiFi needs a password. Set one over USB (section 8).
    end
```

⚠ **One editor at a time** (SPEC §7). Everything the board sends goes to USB *and* to the WiFi session, and
replies carry no request id, so an editor on USB and one on WiFi each see the other's replies. The `HELLO` sent
when a WiFi session starts can land in the middle of the other editor's deploy and read as a restart.

## 3. A file arriving in pieces: the state machine

The flow, and each file of a library, arrive the same way: in pieces, each answered. The board keeps one
**stream** per file, always **idle**, **receiving** or **failed**. The machine is `board.stream` in
`states.json`, which is the ground truth; [`STATES.md`](STATES.md) draws it, generated from the table, alongside
`board.listener` and the editor's `editor.transfer`.

Two rules the editor relies on:

- **Any piece may be sent again.** It rewrites the same bytes and is answered `ok`. So when an answer is lost,
  the editor just resends.
- **Offset 0 always starts over**, whatever came before: an abandoned transfer, a refused commit, a failed write.

Anything else is illegal: a gap, a different `total`, a piece that runs past the end, a piece at offset > 0 while
idle. The board announces it (`PROTOCOL_ILLEGAL`, SPEC §7.6) and answers `BadPiece`.

## 4. Deploy a flow

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    Note over E: Version gate: refuses on a major mismatch,<br/>if a HELLO was seen this connection.<br/>None seen: deploys without checking, and says so.
    Note over E: Compiles the flow to bytecode.
    opt the flow imports libraries
        Note over E,B: Install any the board lacks first (section 7).<br/>A failure there stops the deploy, flow unchanged.
    end
    loop each 5 KB piece: offset 0, 5120, 10240 ...
        E->>B: FLOW_PUT offset, total, data
        Note over B: into /_flow.mpy.tmp (section 3)
        B-->>E: FLOW_ACK offset, ok
    end
    Note over E: only now waits for the commit's answer
    E->>B: FLOW_COMMIT total, flowName, deployId, libraries needed
    Note over B: 1. all bytes arrived?<br/>2. libraries installed?<br/>3. move .tmp over the saved flow<br/>4. stop the running flow, save name/deployId,<br/>start the new flow<br/>5. remove libraries no longer used
    alt the flow started
        B-->>E: DEPLOY_ACK free flash, free RAM
        Note over E: "deploy OK"
    else the board crashed while starting it (a hard fault, not an exception)
        B-->>E: HELLO (after the reboot)
        Note over E: Compares HELLO's deployId with this deploy's:<br/>same = running now, else not running.
    end
```

The editor waits up to 30 s for the answer to the commit.

## 5. Deploy a flow — when a piece goes wrong

Each piece gets up to three tries. A resend never changes the piece or the plan.

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    E->>B: FLOW_PUT offset N
    alt the line reached the board damaged (lost bytes on a USB-UART)
        Note over B: the line isn't one whole frame:<br/>stores nothing, keeps nothing
        B-->>E: FLOW_ACK offset N, ok false, code Garbled
        E->>B: FLOW_PUT offset N (sent again at once)
        B-->>E: FLOW_ACK offset N, ok
    else the board stored the piece, but its FLOW_ACK was lost
        Note over E: no answer in 10 s
        E->>B: FLOW_PUT offset N (sent again)
        Note over B: rewrites the same bytes
        B-->>E: FLOW_ACK offset N, ok
    else the board restarted
        B-->>E: HELLO (boot)
        Note over E: "board restarted during the deploy"
    else three tries without an ok, or any other refusal
        B-->>E: FLOW_ACK offset N, ok false, code, error
        Note over E: deploy failed, reported once.<br/>The next deploy starts at offset 0, cleanly.
    end
```

## 6. Deploy a flow — when the commit fails

The board answers a commit with exactly one `DEPLOY_ACK` or `DEPLOY_ERROR`, and the commit ends the stream
either way. The checks come before anything under a real name changes. Nothing is retried, and the board never
frees memory or restarts by itself to make a retry fit.

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    E->>B: FLOW_COMMIT total, flowName, deployId, libraries
    alt fewer bytes arrived than total
        B-->>E: DEPLOY_ERROR Incomplete
        Note over B: running flow and saved flow untouched
    else a library the flow needs is missing
        B-->>E: DEPLOY_ERROR MissingDependency
        Note over B: running flow and saved flow untouched
        Note over E: forgets what libraries the board has,<br/>so the next Deploy sends them all
    else the saved flow can't be replaced
        B-->>E: DEPLOY_ERROR WriteFailed
        Note over B: running flow and saved flow untouched
    else the new flow raises while starting
        Note over B: old flow already stopped
        B-->>E: DEPLOY_ERROR ImportError / MemoryError / ...
        Note over B: no flow running now. The new flow is saved,<br/>so a reset tries it again (safe mode stops a loop)
        Note over E: advice for ImportError and MemoryError
    end
```

A `DEPLOY_ERROR` can also arrive while pieces are still being sent: a piece the board had no memory to read
gets a `Garbled` answer *and* a `DEPLOY_ERROR MemoryError` (the second is for older editors, which sent the
whole flow in one `DEPLOY`). This editor isn't waiting for a commit answer yet, so it only logs that line and
resends the piece.

## 7. Install a library

Before a flow that imports libraries is deployed, the editor compares each library's hash with the list the
board gave in `HELLO` and sends only the missing or changed ones. Same pattern as a flow: 5 KB pieces, each
answered (section 3's rules, one stream per file), then a commit.

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
            alt stored
                B-->>E: DEP_ACK name, file, offset, ok
            else the line was damaged
                B-->>E: FLOW_ACK ok false, code Garbled
                Note over E: about the line sent last: sends the piece again
            else no answer in 10 s
                Note over E: sends the piece again (any piece may be resent)
            else refused (NoSpace, BadName, WriteFailed)
                B-->>E: DEP_ACK name, file, offset, ok false, code
                Note over E: deploy failed, flow unchanged
            end
        end
        E->>B: DEP_COMMIT name, hash, files and sizes
        Note over B: checks sizes, moves the files into place,<br/>updates its library index. Ends the streams.
        alt installed
            B-->>E: DEP_RESULT name, ok, free flash
        else a file is incomplete, or a write failed
            B-->>E: DEP_RESULT name, ok false, code Incomplete / WriteFailed
            Note over B: deletes the temporary files
        end
    end
    Note over E: then the flow itself (section 4), with the<br/>libraries' hashes in FLOW_COMMIT
```

## 8. Change board settings

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

## 9. Commands with no reply

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

## 10. Things the board says unasked

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
    Note over B: A line it can't read (bad base64, not one<br/>whole frame, a MemoryError reading it):
    B-->>E: FLOW_ACK offset stored so far, ok false, code Garbled
    Note over E: about the line it sent last: sends it again.<br/>Ignored when nothing is waiting.
    Note over B: A whole message of a type it doesn't know:<br/>logged, never answered.
```

## 11. Old and reserved messages

```mermaid
sequenceDiagram
    participant E as Editor
    participant B as Board
    Note over E,B: Whole-flow deploy, for editors before 11.3.0. This<br/>editor never sends it. The board still accepts it,<br/>with the same checks-first order as FLOW_COMMIT.
    E->>B: DEPLOY bytecode, flowName, deployId, libraries
    B-->>E: DEPLOY_ACK or DEPLOY_ERROR (as in section 6)
    Note over E,B: Reserved: the id is kept, nothing uses it.
    B-->>E: VALUE_STREAM (never sent, decided not to build)
    E->>B: STATE_READ (board logs "not yet implemented")
    E->>B: STATE_WRITE (board logs "not yet implemented")
```
