---
title: "Privacy & Security"
urlstring: "privacy-security"
summary: "Understanding data privacy and security with ThingStudio"
---

##Privacy
The privacy aspect of ThingStudio is both surprising and critically important. Surprising in that we are a cloud service which _doesn't_ want your data, and critically important for a number of reasons.

First, it saves us the trouble of building the infrastructure to support massive amounts of IoT data. Second, and much more important, it's the right answer for IoT. Your IoT data will record the day-to-day, minute-to-minute events of your either / both your life and your business. This data is yours, and with ThingStudio it is up to you just how private and secure you decide to make that data.

How can we make this promise of data privacy while delivering a real-time user interface platform? Simple: we can't see your data – it never passes through our servers.

The only caveat to this privacy is if you are using our free MQTT broker, but if you want your data to be private, obviously don't do that.

Aside from that, any time you load a ThingStudio app, you have two open websocket connections: one between our servers and your device which provide the UI for your app, and one between your data source (either MQTT or HTTP) and your device, which provides the data.

Yes, this creates the need for you to provide your own data transport, but for those serious about doing IoT applications right, this is a non-issue. These are the people for whom we have built ThingStudio.

##The ThingStudio Network Structure

![Network Structure](/images/thingstudio-infrastructure.jpg "ThingStudio Infrastructure")
