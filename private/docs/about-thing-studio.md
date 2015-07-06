---
title: "About ThingStudio & MQTT"
urlstring: "about-thing-studio"
summary: "A quick introduction to MQTT, the M2M protocol for the Internet of Things"
---

ThingStudio leverages MQTT, a lightweight publish/subscribe messaging protocol, as a data transport layer between devices and the custom UIs you build. In essence, this is the data flow between your devices and your ThingStudio interfaces: 

### **[Device/s] -[MQTT] - [ThingStudio UI]**

Therefore, the first step to getting up and running with ThingStudio is to run an MQTT broker. If you don't have an MQTT broker, and are using a Mac, download our free MQTT Desktop Broker here: <a href="http://mqtt.thingstud.io/MQTTDesktop.dmg">http://mqtt.thingstud.io/MQTTDesktop.dmg</a>.

Now for a little more background on MQTT. We've included a summary of MQTT from the manual page for the mosquitto broker on http://mosquitto.org.

# Publish/Subscribe

The MQTT protocol is based on the principle of publishing messages and subscribing to topics, or "pub/sub". Multiple clients connect to a broker and subscribe to topics that they are interested in. Clients also connect to the broker and publish messages to topics. Many clients may subscribe to the same topics and do with the information as they please.

The broker and MQTT act as a simple, common interface for everything to connect to. This means that you if you have clients that dump subscribed messages to a database, to Twitter, Cosm or even a simple text file, then it becomes very simple to add new sensors or other data input to a database, Twitter or so on.

# Topics/Subscriptions

Messages in MQTT are published on topics. There is no need to configure a topic, publishing on it is enough.

Topics are treated as a hierarchy, using a slash (/) as a separator. This allows sensible arrangement of common themes to be created, much in the same way as a filesystem. For example, multiple computers may all publish their hard drive temperature information on the following topic, with their own computer and hard drive name being replaced as appropriate:

sensors/COMPUTER_NAME/temperature/HARDDRIVE_NAME

Clients can receive messages by creating subscriptions. A subscription may be to an explicit topic, in which case only messages to that topic will be received, or it may include wildcards. Two wildcards are available, + or #.

\+ can be used as a wildcard for a single level of hierarchy. It could be used with the topic above to get information on all computers and hard drives as follows:

sensors/+/temperature/+

As another example, for a topic of "**a/b/c/d**", the following example subscriptions will match:

* a/b/c/d
* +/b/c/d
* a/+/c/d
* a/+/+/d
* +/+/+/+

The following subscriptions will **not** match:

* a/b/c
* b/+/c/d
* +/+/+

'#' can be used as a wildcard for all remaining levels of hierarchy. This means that it must be the final character in a subscription. With a topic of "**a/b/c/d**", the following example subscriptions will match:

* a/b/c/d
* #
* a/#
* a/b/#
* a/b/c/#
* +/b/c/#

Zero length topic levels are valid, which can lead to some slightly non-obvious behaviour. For example, a topic of "a//topic" would correctly match against a subscription of "a/+/topic". Likewise, zero length topic levels can exist at both the beginning and the end of a topic string, so "/a/topic" would match against a subscription of "+/a/topic", "#" or "/#", and a topic "a/topic/" would match against a subscription of "a/topic/+" or "a/topic/#".