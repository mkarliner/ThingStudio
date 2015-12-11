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

##Transports
Currently, ThingStudio supports two transport mechanisms, MQTT and HTTP. There is no 'correct' choice of transport, it just depends on what services or devices you are connecting to. And of course, you can use more than one transport in the same application.
You can read more about the transport mechanisms in their specific sections: [MQTT](/docs/mqtt-connections-and-feeds), [HTTP](/docs/http-connections-and-feeds).

##Connections
A ThingStudio connection specifies how your ThingStudio  App connects to a given service or device via a transport.

The meaning of a connection depends on the transport, in MQTT, a connection is an MQTT client connection. Currently, we only support one MQTT connection per application, and this is set in the application properties.

In HTTP, a connection refers to a single host and any connection credentials associated with that host. You can have as many HTTP connections as you want in an app, and unlike with MQTT connections, each feed specifies which connection it uses.

##Feeds
A feed is a subdivision of a connection. Again, it's precise meaning varies with each transport:

* For MQTT, a feed generally maps on to a subscription to a topic
* For HTTP, a feed refers to a URL path

Feeds have __feed processing__ associated with them. Feed processing specifies how raw data from the external source is processed after it is received by ThingStudio, and how it is processed before being sent out.

In addition to providing the transforms for data to and from ThingStudio's internal formats, feed processors can also do additional operations on the data to enable richer displays of information.

For example, the built-in __Journal__ feed processor in MQTT feeds keeps a record of the last *n* messages received on the feed, for
use by widgets like the Sparkline time series widget.

You can write your own feed processors to add to those provided by ThingStudio. Details are in the [Advanced](/docs/feed_processing) section of our documentation.

##Templates
Templates define how data from feeds are displayed and how user driven events (i.e. button pushes) are sent to feeds. They consist of HTML with [handlebars](http://handlebarsjs.com/)-style expressions. They will send and receive real-time data without you having to write any additional code, changing the data displayed automatically as it comes in.

This in itself is enough to provide rich real-time user interfaces with no further work, however, ThingStudio templates are also [Meteor](http://meteor.com) templates under the skin, and provide all the [functionality and API](http://docs.meteor.com/#/basic/)'s of Meteor if needed.

To this end, you can write straight Meteor code in the JavaScript section of a template to provide enhanced functionality, although this is only usually needed if you want to reuse your template as a [Widget](/docs/widgets).

##Applications
Applications are simply containers for one or more connections, feeds, and templates. They can be thought of as equivalent to a project in other systems. Applications can inherit connections, feeds, etc. from other applications.

There is an invisible System Application which provides system-level widgets and other resources, such as a connection to the free MQTT broker we provide.

__Note:__ To edit an 'App', it must be active. Activate the app you want to work on by clicking the checkmark for the app [here](/apps).

![Architecture](/images/architecture.jpg "ThingStudio Arcitecture")

##Now what? Start with the Example App
Navigate to [Apps](/apps), where you will find the "Example App" waiting for you. Check to make sure this app is active (if you are brand new to ThingStudio, it will be).

In it, you will see all of the various concepts covered above in action. It already has a connection to our free MQTT broker, a number of feeds have been setup on which we provide example data, as well as a handful of templates, some of which are using our home-grown widgets. Browse around in this app to get a feel for how everything comes together.

__Be aware__, however, that you will be unable to make changes to this app (even though you can load the edit mode of the templates, any changes you make will not be saved) - it is __read-only__.

When you feel confident with how the system is organized, head back to [Apps](/apps), and create your own app to get started by clicking the big green plus sign next to the word "Apps".

##Getting help
If you get stuck, need more information or think you've spotted a bug we need to squash, there is an active [forum](http://forum.thingstud.io/) where we're happy to help you get started. We normally respond to questions within a couple of hours, so feel free to reach out!
