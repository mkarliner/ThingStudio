---
title: "MQTT Connections & Feeds"
urlstring: "mqtt-connections-and-feeds"
summary: "How to create MQTT connections and feeds "
---

## Connections and MQTT
MQTT connections specify a connection to an MQTT broker. You can have as many MQTT connections as you want, but only one can be selected as the active connection in an app at a time. The active connection is specified in the app properties (navigate to [Apps](/apps), and click on the pencil icon to edit the app).

## Creating MQTT connections
The table below describes the attributes of an MQTT connection. You can create a [new MQTT connection here](/mqtt-connection/new).

__Important:__ You will be using your MQTT broker on at least two different ports; one for devices, one for ThingStudio.

###Regular Socket Port
You will normally send data from your __devices__ to your MQTT broker on port 1883, which is the standard port for MQTT over __regular sockets__ (i.e. __NOT web sockets__).

###Websocket Port
Your ThingStudio apps will connect to the MQTT broker on another port via __websockets__ (i.e. __NOT regular sockets__). There is no standard port for MQTT over __websockets__, so you will need to specify that yourself. The free ThingStudio MQTT broker on mqtt.thingstud.io uses port 9001.

{{>DocTable "ConnectionProperties"}}

## Creating MQTT Feeds
MQTT Feeds can be either "publish" or "subscribe", and specify which topics to subscribe to or publish on. In the case of subscribe feeds, they can also specify how to process messages as they arrive. In the rare circumstance that you need to publish and subscribe to the same topic, if you are say, making a chat system, you should create __two__ feeds, one publish, one subscribe, that both reference the same topic.

MQTT feed required parameters are summarized in the table below. Additionally, several optional feed processors are available for "subscribe" feeds. Feed processing let you specify what to do with the message data. Publish feeds always transmit data in JSON format.

{{>DocTable "FeedProperties"}}

## Message formats in MQTT
ThingStudio uses JSON-formatted messages for all MQTT messages, incoming and outgoing. This means that sending non-JSON-formatted messages to ThingStudio will result in runtime errors.

Typically, if you want to send a simple value, like a temperature, simply enclosing it in double quotes with satisfy this requirement.

__Note:__ This means that in many programming languages you will need to escape the double quotes in order to transmit them as part of the message. For example, in an Arduino, you might be transmitting the code line:

<pre>
Serial.println("\"22.1\"")
</pre>

Which will result in the message "22.1" being sent. However, we recommend always using a JSON encoding library rather than the escape string technique.

### Why JSON?
JSON enables you to send highly-structured data, which can be easily parsed by ThingStudio (and really anything else, which is why it is such a popular standard). For example, you could send the following message to ThingStudio, parse it with a helper and do all sorts of powerful stuff in your templates:

<pre>
{
  "device": "this-device-id",
  "owner": "acme-industries",
  "location": "biscuit-factory",
  "timeStamp": 23908490826,
  "eventID": 8927389723,
  "eventType": "box filled",
  "bisquit-types": ["creme", "caramel", "chocolate"]
},
{
  ...
}
</pre>
