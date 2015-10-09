---
title: "ThingStudio Basic Concepts"
urlstring: "basic-concepts"
summary: "How the components of ThingStudio fit together"
---

ThingStudio has a few basic concepts:
+ Transports
+ Connections
+ Feeds
+ Templates
+ Applications

#Transports
ThingStudio defines a transport as a mechanism for getting data in and out of the system.
Currently, ThingStudio supports two transport mechanisms, MQTT and HTTP.
There is no 'correct' choice of transport, it just depends on what services or devices
you are connecting to. And of course, you can use more than one transport in the same application.
You can read more about the transport mechanisms in their specific sections.

#Connections
A ThingStudio connection specifies one particular instance of ThingStudio connecting to a service
or device via a transport. 

The meaning of a connection depends on the transport, in MQTT, a connection is an MQTT client
connection. In HTTP, a connection refers to a single host and any connection credentials associated
with that host.

Currently, we only support one MQTT connection per application, and this is
set in the application properties. 

You can have as many HTTP connections as you want in an app, each feed specifies which connection it uses.

#Feeds
A feed is a subdivision of a connection. Again, it's precise meaning varies with each transport.
For MQTT, a feed generallyt maps on to a subscription to a topic, for HTTP, a feed refers to a URL path.

Feeds have __feed processing__ associated with them. This specifies how raw data from the external source is
processed after having been received by ThingStudio and how it is processed before being sent out.

In addition to providing the transfrom for data to and from ThingStudio's internal formats, feed processors
can also provided additional operations on the data to enable richer displays of information. For example, the
built in __Journal__ feed processor in MQTT feeds keeps a record of the last 'n' messages sent to the feed, for
use by widgets like the Sparkline time series widget.

You can write your own feed processors to add to the list that operate on data. The details are in the Advance section of the documentation.

#Templates
Templates how data from feeds are displayed and how user driven events (button pushes) are sent to to feeds.
They consist of HTML with [handlebars](http://handlebarsjs.com/)-style expressions. They will send and receive real-time data without you having to write any additional code as they will change the data displayed automatically as it comes in.
This in itself is enough to provide rich real-time user interfaces with no further work, however
ThingStudio templates are also exactly [Meteor](http://meteor.com) templates under the skin, and provide all the functionality and API's of Meteor if needed. To this end, you can write straight Meteor code in the javascript section of a template to provide enhanced functionality, although is only usually needed if you want to reuse your template as a widget.

#Applications
Applications are simple a container for one or more connections, feeds, and templates. They can be thought of as equivalent to a project in other systems. Applications can inherit connections, feeds, etc from other applications. There is an invisible System Application which for example, provides a connection to our 