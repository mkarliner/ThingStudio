---
title: 'Templates 2: Displaying data in your Templates'
urlstring: "displaying-data-in-depth"
summary: "Detailed information on creating your first tempaltes and using built-in helpers"
---

ThingStudio uses [Handlebars](http://handlebarsjs.com/)-style helpers to insert live data in to your user interfaces based on Feeds you configure. Handlebars helpers look like this in templates:
<pre>
{{| helpername params }}
</pre>

The above means "insert dynamic data into the DOM using the helper _helpername_ with optional parameters."

##The basic built-in helpers in ThingStudio

There are quite a few built-in helpers available in ThingStudio, and you can read about them in [detail here](/docs/template-helpers-reference). The helpers described here should provide you with a good baseline from which to get started developing you apps:

* Use the '**message**' helper when you are returning values from a feed with no wildcard topics
* Use the '**messages**' helper when you are returning values from a feed containing wildcard topics
* Use the '**feedmatch**' helper with 'messages' to extract part of a topic from your wildcard feed

**Note**: The parameter in the 'message' and 'messages' helpers is the title of your feed, __not__ the MQTT topic (assuming your feed is MQTT). This works a little differently for 'feedmatch', but we'll save the details for that section below. See [MQTT connections & feeds](/docs/mqtt-connections-and-feeds) and [HTTP connections & feeds](/docs/http-connections-and-feeds) for more details on setting up feeds correctly.

Each of these helpers is described in below.

###1. Message
<pre>
{{| message "feedTitleHere" }}
</pre>

Returns the payload as a JSON object of the most recent message from the feed with the title "feedTitleHere". In the case of simple values, that JSON object will just be a simple string. Simply be aware that if your device is sending more information, it may be a more complex object.

We will cover more complex objects in another section.

Let's say we have created an MQTT feed in ThingStudio with the following attributes:

* Title: GardenTemp
* Topic: /myHouse/gardenTemp
* Publish / Subscribe: Subscribe

If the message "20.17" (with double-quotes) is sent on the topic __/myHouse/gardenTemp__, it will be received by the ThingStudio _subscribe_ feed __GardenTemp__, and your template contains the following:

<pre>
&lt;p&gt;Garden temp: {{|message GardenTemp}} degrees&lt;/p&gt;
</pre>

It will render like this:

<pre>
Garden temp: 20.17 degrees
</pre>

As new messages arrive from the MQTT broker on the topic __/myHouse/gardenTemp__, the template will automatically be updated in real-time, with no additional code required.

**When to use**: Use this helper when you want to insert data in to your template from a feed corresponding to a **non-wildcard** MQTT topic. For example:

* /myHouse/gardenTemp, if you have only one temperature sensor in your garden
* /myHouse/garden/temperatures/5, if you have a garden, with multiple types of sensors, one type of which is temperature, and you want the fifth

Both of these would be valid MQTT topics from which to create a feed for usage with the built-in 'message' helper.

If your MQTT topic contains wildcards (+ or #), use the 'messages' helper below, which allows for multiple topics to publish to a ThingStudio UI. In this case, you'll also need to use 'feedmatch'.

###2. Messages

Displaying multiple values from an MQTT wildcard topic is a little bit trickier, though still completely manageable for anyone comfortable with HTML. We'll approach this in small steps.

First, the 'messages' helper itself:

<pre>
{{| #messages "feedTitleHere" }}
...
{{| /messages}}
</pre>

You'll see that the messages helper has a quite different syntax from the other helpers. This is because it is a block
helper. The 'messages' helper allows iteration over an array of objects from the Feed "feedTitleHere". The 'messages' are objects in an array with the following JSON format:
<pre>
{
   &quot; feed&quot;: &quot;&lt;the feed title&gt;&quot;,
    &quot;topic&quot;: &quot;&lt;the name of the topic that sent the message&gt;&quot;,
    &quot;message&quot;: &quot;&lt; the body of the message&gt;&quot;
}
</pre>

The '...' is the code you want to execute for every item in that list.
For instance, if we had a wildcard MQTT topic of '/garden/temperatures/**#place**', (the '#' makes it wildcard, as would a '+') and had stored that topic under the title 'temps' in ThingStudio, the JSON data returned could look like this:

<pre>
{
    "feed": "temps",
    "topic": "/garden/temperatures/strawberries",
    "message": "20.17"
},
{
    "feed": "temps",
    "topic": "/garden/temperatures/onions",
    "message": "19.62"
},
{
    "feed": "temps",
    "topic": "/garden/temperatures/flowers",
    "message": "11.36"
}
</pre>

We've got our 'messages' helper in place, and ThingStudio knows which Feed we're interested in showing data from in our UI. BUT, what we want to do is display both the value and the 'place' that the data is coming from. We do this using 'feedmatch'.

###3. Feedmatch
Again, first the helper itself:

<pre>
{{| feedmatch &lt;tag&gt; }}
</pre>

'feedmatch' serves to tell ThingStudio which part of the topic '/garden/temperatures/#place' we are interested in rendering to the UI, and where to put it. Note: 'feedmatch' is only valid inside a messages block.

We've spoken enough in the abstract about this, now let's make it clear with an example. Keep an eye out for 'messages' and 'feedmatch':

<pre>
{{| #messages "temps"}}
  &lt;tr&gt;
    &lt;td&gt;{{|feedmatch &quot;place&quot;}}&lt;/td&gt;
    &lt;td&gt;{{|payload}}&lt;/td&gt;
  &lt;/tr&gt;
{{| /messages}}
</pre>

Using the sample data from the JSON feed above, this code will output table rows with the content (HTML omitted to clarify the data itself):

<pre>
strawberries 20.17
onions 19.62
flowers 11.36
</pre>

We could have of course used any valid HTML markup instead of tables, but this is a simple example.
