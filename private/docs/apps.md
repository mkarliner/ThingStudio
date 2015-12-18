---
title: "Apps"
urlstring: "apps"
group: "Basics"
summary: "Apps are the basic unit of work in ThingStudio"
---

An app in ThingStudio is simply a collection of connections, feeds and templates that together form a single application.
Any time you are working in ThingStudio, it will be in the context of the "current app". The equivalent in other IDE's might
be a project, or even a folder.

## Inheritance

Apps can inherit resources (connections, feeds, templates, etc.) from another app. __All__ apps invisibly inherit resources from the __System App__. The System App defines the connection to the free ThingStudio MQTT broker, and it also contains all of the system-defined widgets.

This inheritance gives you a variety of convenient ways to organize your work. For example, you might want to create one app on which to base all of your other apps. The "base" app could contain only the details of the connection to your home MQTT broker or an HTTP web service, along with any custom widgets that you might have created, thereby saving you the trouble of creating and maintaining these in each subsequent app.

##Sharing Apps
Apps can be marked as private (default) or shareable. If an app is marked "sharable" you can send anyone the share URL of your app and they will be able to access it immediately.

If you want to have finer control over access to your app, you can setup user credentials in the connection to your MQTT broker, (see [MQTT Connections & Feeds](/docs/mqtt-connections-and-feeds)). That way even if an app is marked as shareable, users with the share URL will still have to provide a username and password to connect to your MQTT broker.

Access control can be similarly configured via HTTP (via basic auth or perhaps .htaccess), if this is your data transport of choice (see [HTTP Connections & Feeds](/docs/http-connections-and-feeds)).

##App-Level CSS & JavaScript
By and large JavaScript programming in ThingStudio is only for advanced use, where you might create [feed processors](/docs/feed_processing) or [widgets](/docs/widgets).

App-level CSS is more commonly used to create a customized look and feel for your application. By default, we do not make any assumptions about the styles of the body of your app, to provide you with maximum flexibility in customizing your app.
