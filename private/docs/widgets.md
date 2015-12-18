---
title: "Templates 5: Widgets"
urlstring: "widgets"
summary: "Widgets are special templates that can be used inside other templates to show custom gauges and buttons"
---

Templates, at their simplest, are just HTML that provide the structure of the view for your data, however, they are also incredibly extensible, as under the hood they are JS objects containing not only your HTML, but also the full richness of Meteor's JavaScript runtime and, as we describe below, the ability to be reused as [Widgets](/docs/widgets).

__Note:__ widgets currently come in two flavors, as detailed below, though this document will be updated in Q1 2016 to reflect the fact that, going forward, widgets will be in library template format only. We recommend that any widgets you create use the library template method, and not web components.

## Widget come in two flavors, Library Templates and Web Components.

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

We supply a set of 'house widgets' for your enjoyment, please feel free to request new widgets on the [Forum](http://forum.thingstud.io) if you have suggestions.

## Making your own widgets

<strong>Library Templates</strong> are just that, they work like normal Templates, except that they can be included into other Templates.

<strong>Web Components</strong> are different because they are used as HTML custom elements. This means that they use the "shadow dom", which means that for CSS and other purposes they are in a complete new, DOM, which accepts styles from your main page, but whose styles cannot "leak" out in to the main page. This is useful if you want a completely free hand at styling your own component.

Web Component tag  names must have a '-' in them, as this is a HTML5 requirement. The ThingStudio house widgets all start with 'ts-', so it's probably a good idea if you avoid using that prefix.

Stay tuned for more information on making your own widgets.
