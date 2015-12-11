---
title: "MQTT Connections & Feeds"
urlstring: "mqtt-connections-and-feeds"
summary: "How to create MQTT connections and feeds "
---

## Connections and MQTT
MQTT connections, fairly obviously, specify the connection to an MQTT broker. You can have as many MQTT connections as you want, but only one can be selected as the active connection in an app at a time. You specify which connection to use in the app properties.



## Creating a connection
{{>DocTable "ConnectionProperties"}}

## Creating Feeds

Feeds specify what MQTT topics to subscribe or publish to and how to process messages as they arrive on subscribe feeds. Feeds can either be publish or subscribe feeds, in the rare circumstance that you need to publish and subscribe to the same topic, if you are
say, making a chat system, you should create two feeds, one publish, one subscribe, that both reference the same topic.

### Feed Processing
As MQTT messages arrive, which should always be in JSON format, the feed processing options specify what to do with the feed. The different options are summarized in the table below.

{{>DocTable "FeedProperties"}}
