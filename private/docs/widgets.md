---
title: "Widgets"
urlstring: "widgets"
summary: "Widgets are special templates that can be used inside other templates to show custom gauges and buttons"
---

## Widget come in two flavours, Library Templates and Web Components.

Library Templates are referenced like this:
<pre>
{{| > ALibraryTemplate param1="asdf"}}
</pre>

Web Components are referenced like this: 
<pre>
&lt;ts-justdial legend=&quot;Fusion Level&quot; value=&quot;{{|message &quot;myfeed&quot;}}&quot;&gt;&lt;/ts-justdial&gt;
</pre>

In this case, <strong>ts-justdial</strong> is the name of the widget, and it has been passed two parameters. Legend is just a string show what the widget is displaying. Value is the value to show, and we are passing it the value of the last message from 'myfeed'. The actual parameters for each widget vary, you can see them by clicking on the details icons  on the widgets page.

If you are just using widgets, there is no difference between to two types apart from how you call them from your own template.

We supply a set of 'house widgets' for your enjoyment, please feel free to request new ones if you have a good idea. 

## Making your own widgets

<strong>Library Templates</strong> are just that, they work like normal Templates, except that they can be included into other Templates. All the normal CSS that we provide or you define in a Theme work as usual.

<strong>Web Components</strong> are different because they are used as HTML custom elements. This means that they use the "shadow dom", which means that for CSS and other purposes they are in a complete new, DOM, isolated from your main page. This is useful if you want a completely free hand at styling your own component. 

Web Component tag  names must have a '-' in them, this is a HTML5 requirement. The ThingStudio house widgets all start with 'ts-', so it's probably a good idea if you avoid using that prefix.

Stay tuned for more information on making your own widgets.