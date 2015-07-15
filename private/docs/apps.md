---
title: "Apps"
urlstring: "apps"
group: "Basics"
summary: "Apps are the basic unit of work in ThingStudio"
---




An app in ThingStudio is  simply a collection of connections, feeds, screens, and theme that together form an single application.
Any time you are working in ThingStudio, it will be in terms of the context of the current app. The equivalent in other IDE's might
be a project, or other term. 
## Inheritance
Apps can created to inherit resources (connections, feeds etc) from another app.  All apps inherit resources from the System App.
This app defines the connection to the free ThingStudio MQTT broker, and also all the system defined widgets.
Inheritance gives you a variety of convenient ways of organising your work.
For example, you might want to create a app on which to base all your apps, which contains just the details of the connection to your home network, and
any widgets that you might have designed so you don't have to define them again in each app.

## Sharing Apps
Apps are can be made shareable. All this means is that you can send anyone the share URL of your app and they will be able to access it immediately without logging into the system. If you want to have better control of your users than just sharing or not sharing, you can set passwords on the connection to your MQTT broker, (see connections). Then, even if an app is shareable, users with the share URL will also have to have a username and password to connect to your MQTT broker.

## Navigating around your app
If you have more than one screen in your app, you can nominate on of them to be the 'home page' which a user will be sent to when they access the share URL.
If you have more than one screen in your app, and have not nominated a home screen, users will be shown a default menu listing all the screens in your app which will enable them to pick one.

## Custom navigation
If you would like to make your own navigation system for your app, nominate a home page and you can then use the following helpers to create links or buttons to send users to other screens in your app.
<pre>
{{|#templatelist }}
	&lt;a href="{{|templateUrl}}"&gt;{{|this.title}}&lt;/a&gt; {{|templateurl}}
{{|/templatelist}}
</pre>

The  templatelist helper is a block helper that gives you a access to the list of screens in your app. The contents of the block, (in this example  the <p>...</p> element can use the templateUrl helper which returns the url of the screen, and the title property of the screen (this.screen) to make labels. This allows you to create your own menu page in any style you want.

There is also the templateURLForName helper which can be used like this:
<pre>
{{templateUrlForName "TimeSeries"}}
</pre>
Which will just return the URL for a screen of a given name.

Finally, for ultimate control there is the templateForName helper, which looks like this.
<pre>
{{|#with templateForName "TimeSeries"}}
	{{|html}}
{{|/with}}
</pre>
This gives you access to all the properties of a screen, including the html and javascript it contains.
This is mainly useful for creating demo screens that show both a working interface and the code that
creates it. 