# WiFi provisioning

You can leave a flow's WiFi network and password out, and enter them on the board when it first starts. Use this
for a board you hand to someone else, or one that goes on a network you don't have the password for.

## Turning it on

In the flow's WiFi config, set **security** to **Unmanaged** and leave the **credential** blank. See
[Config nodes](working-in-the-editor.md#config-nodes). Deploy as usual.

## Entering the network on the board

When the board starts with no saved network, it opens its own WiFi network, **Thingstudio-Setup-XXXX**, with the
password `thingstudio`:

1. Connect a phone or laptop to **Thingstudio-Setup-XXXX**. Most phones open the setup page by themselves. If not,
   browse to `http://192.168.4.1/`.
2. Pick your network from the list, or type its name. Some boards' scans miss nearby networks, so typing always
   works.
3. Enter the password and submit.

Once the board connects, it saves the network and joins it on every later start. If nobody enters a network within
10 minutes, the board carries on starting without WiFi.

## Reopening setup when WiFi fails

By default, setup only runs while no network is saved. If the saved network later becomes unreachable, the board
stays disconnected.

Tick **Allow reprovisioning on connect failure** in the WiFi config to reopen the setup network whenever the saved
network fails. Only do this on a network you control: while the setup network is open, anyone in range who knows its
password can point the board at a different network.

## Changing the setup network's password

There's no field for it in the editor. Connect to the board and type this in the command box under the console
(see [Commands and the Python prompt](debugging.md#commands-and-the-python-prompt)):

```python
import wifi_provision; wifi_provision.set_ap_password('yournewpassword')
```

Then choose **Tools → Reset board (hard)**. Use at least 8 characters: with fewer, the setup network doesn't open.
Set it to `'thingstudio'` to go back to the default.

## Starting over

To make the board forget its saved network and run setup again, type this in the command box, then reset the
board:

```python
import os; os.remove('/_wifi_provision.json')
```

This also clears a changed setup password.
