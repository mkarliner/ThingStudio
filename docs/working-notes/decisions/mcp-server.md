# MCP server for Thingstudio

Status: decision, 2026-10-23 (Mike). Build an MCP server that talks to the running backend (option 2 below),
**post-MVP**. No checker-only wrapper for launch. Follows the open question in `outstanding-items.md` under
"Headless compile/validate" (Mike asked 2026-10-10).

## The two options considered

**Option 1: a wrapper around the checker only.** MCP tools for what `thingstudio-compile` already does: check a
flow (`--json`), `--describe` (the node catalog) and `--board-info`.

- For: works in assistants with no shell (chat apps), which can call MCP tools but not a command; typed JSON
  results instead of exit codes and flags; the catalog and board definitions become discoverable tools or
  resources instead of a pasted `llms.txt`; a listing in MCP directories supports the "AI without the slop" message.
- Against: little gain where a shell exists. Claude Code, opencode and Cursor already use the command well, and
  the `thingstudio-flow-author` skill covers how. In the AI-authoring test rounds, fresh agent sessions with only
  the command and the docs passed the check 5 times out of 5 (`ai-authoring-test-rounds.md`). It is also a
  third interface to keep in step with the CLI and the editor's compile, with its own spec and conformance test
  (`AGENTS.md`, "Interface specs"), and a run-it step for every install route and every client.

**Option 2: a wider surface that talks to the running backend.** Deploy a flow, read the console and node status,
inject a message, as well as the checker tools.

- For: it closes the loop the command can't. Today the honest public claim is "passes the check, never works":
  no AI-written flow has been run on a board by the agent that wrote it. With deploy plus the console, an agent
  sees a runtime error attributed to a node and fixes it. That is a stronger demo than a passing check, and it
  puts the existing error attribution to use. Nothing else offers it.
- Against: see "Before building" below. It is a new way to drive a process that pushes bytecode to hardware, it
  touches the wire protocol, and it lets an agent move real pins and relays.

## Why option 2, and why after MVP

Option 1 mostly duplicates a command that already works for the assistants most users of this project have.
Option 2 is the only one that adds something new. It waits until after MVP because it needs a security design of
its own and changes at a subsystem interface, neither of which should be rushed in before launch.

## Before building

- **Security design first.** `backend-editor-auth-and-protocol.md` cites a 2026 MCP `rust-sdk` advisory
  (`GHSA-89vp-x53w-74fx`) and the "ClawJacked" research: the same attack shape as this backend (a local process,
  reachable over WebSocket, doing something consequential when driven). Points to settle:
  - **Transport.** Prefer stdio, launched by the assistant, over a Streamable HTTP listener, so there is no new
    port to rebind against. If an HTTP transport is ever offered, it gets the same Host allowlist as posture 1.
  - **How the MCP server authenticates to the backend.** Posture 1's Host allowlist stops browsers, not local
    processes. Decide whether the MCP server is just another local client or needs a credential of its own. Check
    against `posture-2-auth.md` (P4, post-MVP) so the two don't design the same thing twice.
  - **Prompt injection.** An agent can be steered by text it reads (a web page, a flow file someone shared, a
    node's docs). With a deploy tool, that text can reach hardware. That is the main reason for the guardrail
    below.
- **Deploy needs a person.** A deploy requested over MCP is confirmed in the editor (or another place the agent
  can't answer for itself) before it reaches the board. Read-only tools (check, describe, board info, console,
  node status) don't need this.
- **Build it in stages.** Checker and read-only tools first, deploy last.
- **Interface rules.** Anything that emits or parses frames reads `interfaces/protocol/` and runs its conformance
  test first; any change to the protocol itself needs Mike's explicit permission (`AGENTS.md`). The MCP tool
  surface is a cross-subsystem interface too, so it gets a spec under `interfaces/` when it lands.
- **One compile.** The MCP check tool calls the same `checkFlowText` as the CLI and the editor, so the errors
  can't drift apart. Keep the open "move the compiler into the backend" question in mind: whichever process owns
  the compile, the MCP server should call it, not carry a copy.

## Open questions for when it's picked up

- Which process hosts the MCP server: the Python backend, or a small separate program that connects to it?
- Inject over MCP: allowed with the same confirmation as deploy, or read-only only?
- Which boards and transports (serial, WiFi) the deploy tool supports at first.

## What would bring it forward

- Round 4 of the AI-authoring test (with a non-Claude assistant) shows chat-only users can't get a flow checked
  without a shell. Then a checker-only first stage could ship earlier, without the backend tools.
