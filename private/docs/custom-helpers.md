---
title: "Custom Helpers"
urlstring: "custom_helpers"
summary: "Making your own helpers"
---

Our built-in [template helpers](/docs/template-helpers-reference) help you do accomplish the most common tasks in your templates, such as displaying real-time data, min, max and average values, etc.

However, you may want to do your own custom manipulations on message data before you display it. Changing Centigrade temperatures to Fahrenheit, for example.

To do this, you can write your own helpers. Custom helpers are defined in template-level JavaScript. Here is an example which does the Centigrade to Fahrenheit conversion, and vice versa.

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

If you want to learn about templates in greater detail, read the [Meteor documentation on templates](http://docs.meteor.com/#/basic/defining-templates).
