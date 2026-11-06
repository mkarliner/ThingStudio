# Remote display principles and the 2015 ThingStudio lineage — briefing

Status: handoff, 2026-11-06. Docs-only session (Claude in the Claude app, linked to Mike's Mac). Nothing built,
nothing committed.

## What happened

1. Reviewed the 2015-2016 ThingStudio documents in `~/Src/ThingStudio2015` (white paper, MOU, the Zito "offering"
   answers, `MeteorJune.pdf`, `TS-0.2.0.pdf`, `March2016IntroKey.pdf`) for relevance in 2026. Conclusion Mike
   agreed with: the thinking (privacy by architecture, infrastructure-agnostic, a small vocabulary of HTML
   template parts) aged better than the implementation (Meteor, hosted IDE, unchecked templates), and the idea
   is most relevant now as a UI format AIs write and humans audit. Same argument as Mike's post
   https://blog.karliner.net/posts/thingstudio-common-ground/.
2. Reviewed `remote-display-scoping.md`; it already applies that argument (the `screens` tree through the flow
   compiler). Review points are now items 10-15 under "For the decision session".
3. Mike stated two design principles (P1 everything is a plugin without a supply-chain hole; P2 the board-served
   page is the first client, not the only one).

## Changed files

- `remote-display-scoping.md`: status line; "Design principles" section (P1, P2); AI-audit bullet in "Why";
  custom-widget paragraph aligned with P1 (data faces by default, confined JS the exception); decision-session
  items 10-15; "History" replaced by "Lineage: the 2015 ThingStudio" (paths to `~/Src/ThingStudio2015` and
  `~/Src/ThingStudioArchive/2019/...`, what carries forward, what is reversed).
- `decisions/remote-display.md` (new, 3 entries) and its section in `decisions.md`.
- `docs/security-policy.md` §1: remote displays added to the "Not yet built" zone row.
- This briefing and its line in `BRIEFINGS.md`.

## Next

- Done later the same session: open questions settled (scoping note, "Where the questions stand"); next is
  the spike, `remote-display-spike-briefing.md`.
- When building: add the phone page as a zone and code source in `security-policy.md` (§1, §3.4) in the same
  change; draft the transport-neutral interface spec under `interfaces/` before the WebSocket code.
- Possible follow-up offered to Mike: compare the 2015 widget set (incl. `DeviceOrientation`) with the current GUI
  widgets to see which deserve a remote face.

## Environment

- The session worked through the Cowork Linux VM (`device_bash`) with `~/Src/ThingStudio` and
  `~/Src/ThingStudio2015` mounted under `$HOME/mnt/`. Old `.doc` files read with
  `soffice --headless --convert-to txt:Text`, PDFs with `pdftotext -layout`; `pandoc` cannot read the `.pptx`
  decks (empty output), use the PDFs. Edits made with Python read-modify-write; no npm, PyPI or board tooling
  used. Deletion is off in the mounts, so git commit from the VM would leave lock files: commit on the Mac.
