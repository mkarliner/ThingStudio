---
title: "Apps"
urlstring: "apps"
group: "Basics"
summary: "Apps are the basic unit of work in ThingStudio"
---

An app in ThingStudio is  simply a collection of connections, feeds, screens, and theme that together form an single application.
Any time you are working in ThingStudio, it will be in terms of the context of the current app. The equivalent in other IDE's might
be a project, or something similar.

## Inheritance

Apps can created to inherit resources (connections, feeds etc) from another app.  All apps inherit resources from the System App.
This app defines the connection to the free ThingStudio MQTT broker, and also all the system defined widgets.

Inheritance gives you a variety of convenient ways of organizing your work. For example, you might want to create a app on which to base all your apps, which contains just the details of the connection to your home network, and any widgets that you might have designed so you don't have to define them again in each app.

## Sharing Apps

Apps are toggleable as private / shareable. If an app is marked "sharable" or "public" you can send anyone the share URL of your app and they will be able to access it immediately without logging into the system.

If you want to have better control of your users than just sharing or not sharing, you can setup user credentials in the connection to your MQTT broker, (see [MQTT Connections & Feeds](/docs/mqtt-connections-and-feeds)). That way even if an app is shareable, users with the share URL will also have to prodivde a username and password to connect to your MQTT broker.

Access control can be simiarly configured via HTTP, if that is your data transport of choice (see [HTTP Connections & Feeds](/docs/http-connections-and-feeds)).

## Navigating around your app

If you have more than one template in your app, you can nominate one of them to be the 'home page' which a user will be sent to when they access the share URL.

If, again, you do have more than one screen in your app, and have <strong>not</strong> nominated a home screen, users will be shown a default menu listing all the screens in your app which will enable them to pick one.

To make your own custom navigation, [read this doc](/docs/custom-navigation).
