# Node-RED

[Node-RED](https://nodered.org/) is a free tool for wiring together devices, web services and APIs. You build
programs, called flows, in a browser by dragging nodes onto a canvas and wiring them up. It was created at IBM in
2013 and is now an OpenJS Foundation project.

## What people use it for

Node-RED is popular for home automation and IoT. A typical flow might take sensor readings from MQTT, check them,
store them in a database and send an alert when something is out of range. It has thousands of add-on nodes and a
dashboard for building simple web UIs.

## Where it runs

Node-RED runs on Node.js, on a server, a PC or a Raspberry Pi. Microcontrollers usually talk to it over the
network, often by MQTT, and run their own separate firmware.

## Where Thingstudio fits

Thingstudio takes Node-RED's way of working onto the microcontroller. The flow runs on the board itself, so the
board doesn't need a server to decide what to do. The two work well together: a Thingstudio board can publish
readings over MQTT to a Node-RED flow on your server.

If you already use Node-RED, see [coming from Node-RED](../coming-from/node-red.md) for what's different.

## More

- [Node-RED concepts](https://nodered.org/docs/user-guide/concepts)
- [Node-RED getting started](https://nodered.org/docs/getting-started/)
