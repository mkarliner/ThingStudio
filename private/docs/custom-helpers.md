---
title: "Custom Helpers"
urlstring: "custom_helpers"
summary: "Making your own template helpers"
---

Our built-in [template helpers](/docs/template-helpers-reference) help you accomplish the most common tasks in your templates, such as displaying real-time data, min, max and average values, etc.

However, you may want to do your own custom manipulations on message data before you display it. For example, changing Centigrade temperatures to Fahrenheit. To do this, you can write your own helpers.

##Defining custom helpers
Custom helpers are defined in template-level JavaScript. Here are two examples, the first does the Centigrade to Fahrenheit conversion, and the second converts Fahrenheit to Centigrade.

<pre>
Template[name].helpers({
    cToF: function(c) {
      return c * 9 / 5 + 32
    },
    fToC: function(f) {
      return (f - 32) * 5 / 9
    }
})
</pre>

##Using custom helpers
To use these helpers in your templates, simply enclose them in double curly braces, and include the name of the feed to process with the helper. For example:

<pre>
{{|yourHelperHere "feedTitleHere"}}
</pre>

##Learn more
If you want to learn about templates in greater detail, read the [Meteor documentation on templates](http://docs.meteor.com/#/basic/defining-templates).
