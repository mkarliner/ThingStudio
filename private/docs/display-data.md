---
title: 'Displaying data in your Templates'
urlstring: "displaying-data-in-depth"
summary: "More about displaying data"
---


ThingStudio uses <a href="http://handlebarsjs.com/" target="_blank">Handlebars</a>-style helpers to insert live data in to your user interfaces based on Feeds you configure. Handlebars helpers look like this in templates:

    {{| helpername params }} 

The above means "insert dynamic data into the DOM using the helper _helpername_ with optional parameters."

## There are currently three helpers in ThingStudio: 'message', 'messages' & 'feedmatch'

For a quick summary:

* Use '**message**' when you are returning values from a Feed with no wild card topics
* Use '**messages**' when you are returning values from a Feed containing wildcard topics
* Use '**feedmatch**' with 'messages' to extract part of a topic from your wildcard feed

**Note**: *This is very important*: the parameter in 'message' and 'messages' is the **title** of your Feed, NOT the MQTT subscription. This works a little differently for 'feedmatch', but we'll save the details for that section below. See <a href="/docs/feeds">Feeds</a> for more details on setting up Feeds correctly.

Lots more details on each of these below, so let's get started.

### 1. Message

    {{| message "feedTitleHere" }}

Returns the payload as a JSON object of the most recent message from the Feed with the title "feedTitleHere". In the case of simple values, that JSON object will just be a simple string. Simply be aware that if your device is sending more information, it may be a more complex object.

We will cover more complex objects in another section.

Let's say we have a Feed saved with the following values:

* Title: GardenTemp
* Subscription: /myHouse/gardenTemp
* Action: Update

If the latest MQTT message  '20.17' is sent on the topic '/myHouse/gardenTemp' to the ThingStudio Feed  'GardenTemp', and  your template contains the following:

    &lt;p&gt;Garden temp: {{|message GardenTemp}} degrees&lt;/p&gt;

it will render like this:

    Garden temp: 20.17 degrees

As new messages arrive from the MQTT broker on the topic '/myHouse/gardenTemp', the Screen will automatically be updated.

**When to use**: Use this helper when you want to insert data in to your template from a Feed corresponding to a **non-wildcard** MQTT topic. For example:

* '/myHouse/gardenTemp', if you have only one temperature sensor in your garden
* '/myHouse/garden/temperatures/5', if you have a garden, with multiple types of sensors, one type of which is temperature, and you want the fifth

Both of these would be valid MQTT topics from which to create a Feed, whose title you would use in a ThingStudio UI, using the 'message' helper.

If your MQTT topic contains wildcards (+ or #), use the 'messages' helper below, which allows for multiple topics to publish to a ThingStudio UI. In this case, you'll also need to use 'feedmatch'. Read on.

### 2. Messages

Displaying multiple values from an MQTT wildcard subscription is a little bit trickier, though still completely manageable for anyone comfortable with HTML. We'll approach this in small steps.

First, the 'messages' helper itself:

    {{| messages "feedTitleHere" }}

Now, don't be scared off by this next sentence, which may or may not be more technical jargon than you want to handle (if it makes your eyes glaze over, keep reading, the example below will make it much more simple).

The 'messages' helper returns an array of objects from the Feed "feedTitleHere". The 'messages' are objects in an array with the following JSON format:

    {
       &quot; feed&quot;: &quot;&lt;the feed title&gt;&quot;,
        &quot;topic&quot;: &quot;&lt;the name of the topic that sent the message&gt;&quot;,
        &quot;message&quot;: &quot;&lt; the body of the message&gt;&quot;
    }

For instance, if we had a wildcard MQTT subscription of '/garden/temperatures/**#place**', (the '#' makes it wildcard, as would a '+') and had stored that subscription under the title 'temps' in ThingStudio, the JSON data returned could look like this:

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

We've got our 'messages' helper in place, and ThingStudio knows which Feed we're interested in showing data from in our UI. BUT, what we want to do is display both the value and the 'place' that the data is coming from. We do this using 'feedmatch'.

### 3. Feedmatch

Again, first the helper itself:

    {{| feedmatch &lt;tag&gt; }}

'feedmatch' serves to tell ThingStudio which part of the subscription '/garden/temperatures/#place' we are interested in rendering to the UI, and where to put it. Note: 'feedmatch' is only valid inside a messages block.

We've spoken enough in the abstract about this, now let's make it clear with an example. Keep an eye out for 'messages' and 'feedmatch':

    {{|#each messages "temps"}}
       &lt;tr&gt;&lt;td&gt;{{|feedmatch &quot;place&quot;}}&lt;/td&gt;&lt;td&gt;{{|payload}}&lt;/td&gt;&lt;/tr&gt;
    {{|/each}}

Using the sample data from the JSON feed above, this code will output table rows with the content (HTML omitted to clarify the data itself):

    strawberries 20.17
    onions 19.62
    flowers 11.36

We could have of course used any valid HTML markup instead of tables, but this is a simple example.