# Connecting over WiFi

Once a board is set up, the editor can reach it over WiFi instead of USB. Deploy, the console, Check status and
inject clicks all work the same way.

## What you need

- A board with WiFi, running Thingstudio runtime 3.0.0 or later. Plain Raspberry Pi Pico and Pico 2 boards have no
  WiFi.
- A flow on the board with a [wifi status](nodes/wifi-status.md) node that has joined your network. The board is
  only reachable while that flow is running. It starts again by itself after a reset.
- A board password, set over USB.
- This computer on the same network as the board.
- On a Mac, Thingstudio started from Apple's Terminal app. See [If it doesn't connect](#if-it-doesnt-connect).

## Set the password and name

1. Connect the board over USB.
2. Click **Board settings…**.
3. Enter a network name and a password of 8 to 64 characters, then click **Save to board**.

The name and password are stored on the board, not in the flow. The editor also remembers the password on this
computer. A board with no password only accepts USB.

A new name is used from the next time the board joins WiFi. Reset the board to use it straight away.

## Connect

Click **⟳ ports**. Boards on your network appear in the port menu under **WiFi**. Pick one and click
**Connect**.

If the board isn't listed, choose **WiFi address…** and type its name (for example `kitchen` or `kitchen.local`)
or its IP address.

If this computer has no saved password for the board, the editor asks for it.

## Good to know

- Only one editor can connect over WiFi at a time.
- Board settings can only be changed over USB.
- Installing the runtime and **Remove flow…** need USB.
- Deploying a flow without a **wifi status** node takes the board off the network at its next reset.
- The password is never sent over the network, but the connection isn't encrypted. Use it on a network you
  trust.

## If it doesn't connect

The console says what went wrong:

- **No route to host (Mac):** macOS is blocking local network access. Start Thingstudio from Apple's **Terminal**
  app, which macOS always allows. Other terminals, such as iTerm, often aren't enough, even when they're allowed in
  System Settings > Privacy & Security > Local Network.
- **No answer:** check the board is on, its flow's **wifi status** node shows connected, and this computer is on the
  same network. If a `.local` name doesn't work, try the IP address, shown in the console when you connect over USB.
- **Wrong password:** the editor asks again. To change it, connect over USB and use **Board settings…**.
- **Already has a network session:** another editor is connected. Disconnect it first.
- **No password set:** set one over USB in **Board settings…**.
