---
title: "Templates"
urlstring: "templates"
summary: "Templates are the user interface of your app: objects containing HTML & JS which show live data from your feeds"
---

Templates are simple HTML templates that provide the structure of the view for your data.

They are also where you specify how data **from** "Feeds" will be rendered, and what messages to publish **to** "Feeds" when data is entered on a input or a when button is clicked.

 The Template live editor in "Studio Mode" is where you'll spend most of your time in ThingStudio, at least while you are developing your user interface.



## Showing live data in your UIs

Data is inserted from "Feeds" into your templates by using handlebars/mustache-style helpers (the use of double curly braces, i.e. '{{stuff}}') to HTML elements.

The only difference between standard HTML5 and what you create in ThingStudio is the concept of these Handlebars helpers. If you haven't used Handlebars, here's how it works:
<pre>
{{|message "feedTitleHere"}}
</pre>
The code above will insert data in to your template **from** a Feed with the title "feedTitleHere".

**Note**: We are using the feed title, **not** the topic/subscription.

Simply add these Handlebars helpers anywhere you want to display live data from an MQTT topic. This can be in an paragraph tag, the value for a checkbox or a widget, a live update to a CSS value (i.e. setting classes or widths based on live data). Truly, the only limit is your imagination.

## Sending data to devices from your UIs

Displaying live data is fun, but controlling your devices in real time is even more fun! And ThingStudio makes it easy.

Send interaction data (clicks, input changes and more) and other data *to* your Feeds by simply adding data attributes to your HTML elements. The syntax resembles the following:
<pre>
&lt;button data-feed="Doorbell" data-message="doorbell"&gt;Bing Bong&lt;/button&gt;
</pre>
Here we're creating a standard HTML button and adding two 'data' attributes:

* data-feed
* data-message

'data-feed' tells ThingStudio the title (**not** the subscription!) of the Feed we want to send data **to** (we want to send data back up the wire here).

'data-message' tells ThingStudio what the payload (i.e. content) of that message is. 'data-message' is not required for events that already have a value defined for the message, like a slider movement, which transmits the value of the slider.

Think of this as an envelope you send through the mail; 'data-feed' is the address you put on the outside of the envelope, and 'data-message' is the letter you put inside.
