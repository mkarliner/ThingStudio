# The Thingstudio folder

Thingstudio keeps its own files in one folder on your computer:

- macOS and Linux: `~/.thingstudio`
- Windows: `%USERPROFILE%\.thingstudio`

Thingstudio creates the folder the first time it starts. Your flows are not kept here. They are saved wherever you
choose (see [Flow lifecycle](flow-lifecycle.md#save-and-open)).

## What's in it

| Folder | Holds | Edit by hand? |
|---|---|---|
| `credentials/` | WiFi and MQTT broker logins, saved by name | No, use the editor |
| `presets/` | Saved node settings, one folder per node type | Yes |
| `custom-nodes/` | Your own node types | Yes |
| `boards/` | Board definitions | Yes |
| `processors/` | Processor definitions | Yes |

Every file is plain JSON, except the Python half of a custom node. The editor reads these folders through the
Thingstudio backend, so the direct (WebSerial-only) connection mode can't use them.

## Credentials

A WiFi or MQTT broker config node holds only the name of a credential. The SSID, password, broker address and login
are stored in `credentials/wifi/<name>.json` or `credentials/mqtt-broker/<name>.json`. This keeps secrets out of flow
files you share or commit. Create and edit credentials from the config node (see
[Config nodes](canvas-basics.md#config-nodes)).

The files are not encrypted. Anyone who can read your home folder can read them. Don't commit this folder or copy it
to shared storage.

## Presets

A preset is a named set of property values for one node type, such as the pins and size of a display panel. You save
and load presets from a node's property panel (see [Presets](canvas-basics.md#presets)). Each one is a file at
`presets/<node type>/<name>.json`. A file that isn't valid JSON appears in the list disabled, with the file named.

## Custom nodes

A custom node is two files with the same base name: `<name>.node.json` and `<name>.node.py`. The first time
Thingstudio starts, it puts two examples here. Deleted examples don't come back. See
[Custom nodes](custom-nodes.md).

## Boards and processors

At every start, Thingstudio copies any built-in definition that's missing from `boards/` and `processors/`. It never
overwrites a file that's already there.

- To change a built-in, edit its file.
- To get the original back, delete the file and restart Thingstudio.
- After an upgrade, an existing copy still wins over a changed built-in, until you delete it.

See [Boards and processors](boards.md).

## Using a different folder

Start Thingstudio with `--data-dir`:

```sh
thingstudio --data-dir ~/projects/greenhouse/thingstudio-data
```

This keeps separate sets of credentials, presets and custom nodes, for example one per project.
