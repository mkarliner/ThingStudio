# WiFi provisioning

A device can learn its WiFi credentials on its own, over the air, instead of having them baked into a flow. This is for a device you're handing to someone else, or setting up somewhere you don't want to type a password into the editor.

## Turning it on

Set a WiFi config's security to **"unmanaged"** (see [Canvas basics](canvas-basics.md#config-nodes)). This tells the device to bring up its own setup network the first time it boots with no stored credential, instead of connecting itself.

## What happens on the device

On first boot with nothing stored, the device opens its own WiFi network — named **Thingstudio-Setup-XXXX**, password `thingstudio` by default. Connect a phone or laptop to it; most phones prompt you to sign in automatically. If not, browse to `http://192.168.4.1/`.

Pick your network from the list, or type its name directly if it isn't listed — some boards' WiFi scans don't reliably find every nearby network, so the form always accepts a typed name too. Enter the password and submit.

Once it connects, the device saves what you entered and joins that network on every later boot. It won't reopen its setup network again unless you've turned on the reprovisioning fallback below.

## Reprovisioning fallback

By default, provisioning only happens once. If the saved network later becomes unreachable, the device just stays disconnected — it doesn't try to reopen its setup network on its own.

The WiFi config has an **"Allow reprovisioning on connect failure"** field for that case. Turning it on means the setup network reopens any time the saved connection fails, not just on first boot.

**Only turn this on for a device on a trusted, physically-controlled network.** An unauthenticated-by-default recovery network that reopens whenever WiFi drops is itself a risk — anyone in radio range during the drop could connect and redirect the device to a different network.

## Changing the setup network's password

There's no editor setting for this yet. The default is `thingstudio`; to set your own, connect to the board and run:

```
mpremote connect /dev/tty.usbmodemXXXX exec "import wifi_provision; wifi_provision.set_ap_password('yournewpassword')"
```

Reset the board afterward. Run the same command with `'thingstudio'` to go back to the default.

## Starting over

To make a device forget its saved network and run first-run setup again, delete its saved state:

```
mpremote connect /dev/tty.usbmodemXXXX fs rm :/_wifi_provision.json
```

This also clears any AP password override you'd set.
