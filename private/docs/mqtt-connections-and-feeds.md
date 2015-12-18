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
MQTT feeds can be either "publish" or "subscribe", and specify which topics to subscribe to or publish on. In the case of subscribe feeds, they can also specify how to process messages as they arrive. In the rare circumstance that you need to publish and subscribe to the same topic, if you are say, making a chat system, you should create __two__ feeds, one publish, one subscribe, that both reference the same topic.

MQTT feed required parameters are summarized in the table below. Additionally, several optional feed processors are available for "subscribe" feeds. Feed processing let you specify what to do with the message data. Publish feeds always transmit data in JSON format.

The table below describes the attributes of an MQTT feed. You can create a new [MQTT feed](/mqtt-feed/new) here.

{{>DocTable "FeedProperties"}}

## MQTT Background
We've included a summary of MQTT from the manual page for the Mosquitto broker on http://mosquitto.org.

###Publish / Subscribe
The MQTT protocol is based on the principle of publishing messages and subscribing to topics, or "pub/sub". Multiple clients connect to a broker and subscribe to topics that they are interested in. Clients also connect to the broker and publish messages to topics. Many clients may subscribe to the same topics and do with the information as they please.

###Topics
Messages in MQTT are published on topics. There is no need to configure a topic on your broker, publishing on it is enough.

Topics are treated as a hierarchy, using a slash (/) as a separator. This allows sensible arrangement of common themes to be created, much in the same way as a filesystem. For example, multiple computers may all publish their hard drive temperature information on the following topic, with their own __computer__ and __hard drive__ name being replaced as appropriate:

sensors/__COMPUTER_NAME__/temperature/__HARDDRIVE_NAME__

Clients can receive messages by creating subscriptions. A subscription may be to an explicit topic, in which case only messages to that topic will be received, or it may include wildcards.

###Wildcard topics
Two wildcards are available, __+__ or __#__.

__+__ can be used as a wildcard for a _single level of hierarchy_. It could be used with the topic above to get information on all computers and hard drives as follows:

sensors/+/temperature/+

As another example, for a topic of __a/b/c/d__, the following example subscriptions will match:

+ a/b/c/d
+ +/b/c/d
+ a/+/c/d
+ a/+/+/d
+ +/+/+/+

The following subscriptions will not match:

+ a/b/c
+ b/+/c/d
+ +/+/+

__#__ can be used as a wildcard for all remaining levels of hierarchy. This means that it must be the final character in a subscription. With a topic of __a/b/c/d__, the following example subscriptions will match:

+ a/b/c/d/#
+ a/#
+ a/b/#
+ a/b/c/#
+ +/b/c/#

Zero length topic levels are valid, which can lead to some slightly non-obvious behavior.

For example, a topic of __a//topic__ would correctly match against a subscription of __a/+/topic__. Likewise, zero length topic levels can exist at both the beginning and the end of a topic string, so __/a/topic__ would match against a subscription of __+/a/topic__, "#" or "/#", and a topic __a/topic/__ would match against a subscription of __a/topic/+__ or __a/topic/#__.

##ThingStudio extentions to MQTT wildcards
As you can see above, standard MQTT wildcards are isolated between slash (/) characters. We've extended this syntax, slightly, to allow named wildcard subscriptions such as:

+ /devices/+DEVICEID

This will allow you to examine the exact, unique topics that devices are sending messages on, and perform regex operations on them, by using the named wildcard you see above.

Each new message replaces any previous messages from the same topic, or creates a new entry if there was none before.

Note that when using wildcard subscriptions, a feed may produce more than one entry. Thus: a subscription of /temperature/+room will match /temperature/frontroom and /temperature/backroom.

To learn how to use these named wildcards in your templates, read [Templates 2: Displaying data in your Templates](/docs/displaying-data-in-depth).

## Message formats in MQTT
ThingStudio uses JSON-formatted messages for all MQTT messages, incoming and outgoing. This means that sending non-JSON-formatted messages to ThingStudio will result in runtime errors.

Typically, if you want to send a simple value, like a temperature, simply enclosing it in double quotes with satisfy this requirement.

__Note:__ This means that in many programming languages you will need to escape the double quotes in order to transmit them as part of the message. For example, in Arduino C++, you might be transmitting the code line:

<pre>
Serial.println("\"22.1\"")
</pre>

Which will result in the message "22.1" being sent. However, we recommend always using a JSON encoding library rather than the escape string technique for anything other than trivial messages.

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
