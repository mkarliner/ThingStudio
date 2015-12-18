---
title: "Templates 1: The basics"
urlstring: "templates"
summary: "Templates are the user interface of your app"
---

ThingStudio templates are plain HTML5 with the additional of Handlebars-style helpers, which specify what data from your devices will be displayed and what data is sent to your devices.

## Real-time out of the box
Templates are declarative, and display and deliver data dynamically without your needing to code event handlers, etc.

## Displaying data in your UIs
Data is inserted from feeds into your templates by adding Handlebars / mustache-style helpers to HTML elements. The only difference between standard HTML5 and what you create in ThingStudio is the concept of these Handlebars helpers. If you haven't used Handlebars, here's how it works:

<pre>
{{|message "feedTitle"}}
</pre>

The code above will use the [built-in helper](/docs/template-helpers-reference) called "message" to render incoming data from a subscribe feed titled "feedTitle" into your template.

**Note**: It is important to note that we are using the feed **title** in our helper, and NOT the associated topic/subscription (were this an MQTT feed).

Add a helper to your HTML anywhere you want to display or leverage data from an MQTT _subscribe_ feed, or, any HTTP feed. This could be in a paragraph tag, as the state for a checkbox or a widget, or even a live update to a CSS value (i.e. setting classes based on live data). Below are examples of each of the above:

Inserting data in to a paragraph tag:
<pre>
&lt;p&gt;The current value is: {{|message "feedTitle"}}.&lt;/p&gt;
</pre>

Assigning the state of a checkbox:
<pre>
&lt;input type="checkbox" name="Kitchen Light" value="On"&gt;
</pre>

Setting a CSS class on an element, allowing us to style the content based on pre-defined CSS rules:
<pre>
&lt;div class='{{|message "feedTitle"}}'&gt;
  &lt;p&gt;The surrounding div of this paragraph will have it's value set by a helper.&lt;/p&gt;
&lt;/div&gt;
</pre>

These are far from the only possibilities, and we encourage you to think creatively about how to use real-time data to make your UIs pop. If you come up with a template or an app that you are particularly happy with, let us know on the [forum](http://forum.thingstud.io/)!

## Template helpers
We have created a number of built-in template helpers to help you do accomplish the most common tasks in your templates. To learn more about these helpers, [read this doc](/docs/template-helpers-reference).

## Transmitting data from your UIs
Transmit data (clicks, value changes, etc.) to your feeds by adding custom attributes to your HTML elements. Custom attributes are always prefixed by 'data-'. The syntax resembles the following:

<pre>
&lt;button data-feed="Doorbell" data-message="doorbell"&gt;Bing Bong&lt;/button&gt;
</pre>

Here we're creating a standard HTML button and adding two 'data' attributes:

* data-feed: the title (not the topic) of the feed on which we want to transmit data.
* data-message: tells ThingStudio what the payload (i.e. content) of that message is. 'data-message' is not required for events that already have a value defined for the message, like a slider movement, which transmits the value of the slider.

You can think of this as an envelope you send through the mail: 'data-feed' is the address you put on the outside of the envelope, and 'data-message' is the letter you put inside.

For more information on feed attributes, [read this doc](/docs/attributes-reference).

## An important note on MQTT vs. HTTP feeds in templates
There is a bit of subtlety you should be aware of between usage of MQTT & HTTP feeds in templates.

### MQTT
MQTT feeds are always either delineated as Subscribe or Publish - they can only be one or the other. There is a whole doc on MQTT feeds [you can read here](/docs/mqtt-connections-and-feeds), but the distinction to be aware of in the context of templates is that you cannot expect to _receive_ data on a Publish feed, nor can you expect to _transmit_ data on a Subscribe feed.

You can always and only _receive_ data on a Subscribe feed and _transmit_ data on a Publish feed.

Pay attention to this distinction when deciding which feeds to use where in your templates. Again, this is for MQTT only.

### HTTP
With HTTP feeds, data can be both transmitted and received on the same feed, so this distinction does not exist for HTTP.

## Learning more
If you want to learn about templates in greater detail, read the [Meteor documentation on templates](http://docs.meteor.com/#/basic/defining-templates).
