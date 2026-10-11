# Step 2: Tour the editor

Start Thingstudio if it isn't running. See [step 1](getting-started.md#start-thingstudio). The editor opens in your
web browser.

<figure markdown="span">
  [![The Thingstudio editor with each part labelled](images/editor-parts.png)](images/editor-parts.png)<figcaption>The parts of the editor. Click to see it full size.</figcaption>
</figure>

<!-- The labels on the picture come from EDITOR_PARTS in tools/screenshots.py. Keep the names below in step. -->

## Toolbar

- **File:** start a new flow, open one, or save it.
- **Flow name:** saved with the flow. The board reports it, so you can tell what it's running.
- **Port list and Connect:** pick your board's port and connect to it. **⟳** looks for boards again.
- **Board menu and Pins…:** the board the flow is for, and a page of its pins.
- **Compile → Deploy:** turns the flow into MicroPython and sends it to the board.
- **Tools and Help:** occasional board jobs, such as installing the runtime, and these docs.

## Palette

Every node you can add, in three groups: **General**, **Network** and **Hardware**. Drag a node onto the canvas, or
click it. Type in the filter box to find one. [Custom nodes](custom-nodes.md) appear under their own group.

## Canvas

Where you build the flow. The flow tabs along the top spread a flow across several sheets.

- **Wire two nodes:** drag from one node's output, on its right, to another node's input, on its left.
- **Select:** click a node or a wire. Ctrl-click to select several nodes.
- **Delete:** select, then press Delete or Backspace. Deleting a node removes its wires too.

The editor refuses a wire between ports whose types don't fit. See [Wiring](working-in-the-editor.md#wiring).

## Properties, notes and console

- **Properties:** the selected node's settings.
- **Notes:** free text about the flow, saved with it.
- **Compiled source:** the MicroPython made from your flow. Click to open it.
- **Console:** messages from Thingstudio and the board, including your flow's output.
- **Python prompt:** runs a line of Python on the board.
- **Board buttons:** stop the flow and use MicroPython's own prompt, or remove the saved flow.

[Working in the editor](working-in-the-editor.md) covers node labels, presets, config nodes and node status.

## Next

Step 3: [install MicroPython](installing-micropython.md) on your board.
