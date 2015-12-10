---
title: "Custom Navigation"
urlstring: "custom-navigation"
group: "Advanced"
summary: "Create custom navigation for your app to override the default behavior and styles"
---

## Custom navigation

If you would like to make your own navigation system for your app, nominate a home page and you can then use the following helpers to create links or buttons to send users to other screens in your app.

<pre>
{{|#templateList }}
	&lt;a href="{{|templatePath}}"&gt;{{|this.title}}&lt;/a&gt;
{{|/templateList}}
</pre>

The templateList helper is a block helper that gives you a access to the list of templates in your app. The contents of the block, (in this example the <strong>&lt;p&gt;...&lt;/p&gt;</strong> element can use the templatePath helper which returns the path of the template, and the title property of the template (this.title) to make labels. This allows you to create your own menu page in any style you want.

There is also the templatePathByName helper which can be used like this:

<pre>
{{|templatePathByName "TimeSeries"}}
</pre>

Which will just return the path for a screen of a given name.

Finally, for ultimate control there is the templateByName helper, which looks like this.

<pre>
{{|#with templateByName "TimeSeries"}}
	{{|html}}
{{|/with}}
</pre>

This gives you access to all the properties of a template object, including the html and javascript it contains.
This is mainly useful for creating demo screens that show both a working interface and the code that
creates it.
