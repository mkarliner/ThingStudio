---
title: "MQTT Connections & Feeds"
urlstring: "mqtt-connections-and-feeds"
summary: "How to create MQTT connections and feeds "	
---

## Connections and MQTT
Connections, fairly obviously, specify the connection to an MQTT broker.
You can have as many connections as you want, but only one will be used
in an App. You specify which connection to use in the App properties.

You will normally send data from your devices to your MQTT broker on port 1883,
which is the standard port for MQTT over regular sockets. 
Your ThingStudio Apps will connect to the MQTT broker on some other port.
Unfortunately, there is no standard port for MQTT over websockets, so you
will need to specify that yourself. The free ThingStudio MQTT broker on
mqtt.thingstud.io uses port 9001.
## Creating a connection

{{>DocTable "ConnectionProperties"}}


## Creating Feeds

Feeds specify what MQTT topics to subscribe or publish to and how to process messages
as they arrive on subscribe feeds.  Feeds can either be publish or subscribe feeds, in the
rare circumstance that you need to publish and subscribe to the same topic, if you are
say, making a chat system, you should create two feeds, one publish, one subscribe, that both
reference the same topic.

### Feed Processing
As MQTT messages arrive, which should always be in JSON format, the feed processing options
specify what to do with the feed. The different options are summarized in the table below.


{{>DocTable "FeedProperties"}}



