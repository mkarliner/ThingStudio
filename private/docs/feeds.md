---
title: "Feeds"
urlstring: "feeds"
summary: "Feeds specify what data you send and receive to and from MQTT"
---

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