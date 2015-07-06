---
title: "Widgets"
urlstring: "widgets"
summary: "Widgets are special templates that can be used inside other templates to show custom gauges and buttons"
---


Widgets are accessed by custom HTML5 elements.
We supply a base set of widgets for your use, which all start with 'ts-'.
You use a widget like this: 

<pre>
	&lt;ts-justdial legend=&quot;Fusion Level&quot; value=&quot;{{|message &quot;myfeed&quot;}}&quot;&gt;&lt;/ts-justdial&gt;
</pre>

In this case, ts-justdial is the name of the widget, and it has been passed two parameters. Legend is just a string show what the widget is displaying. Value is the value to show, and we are passing it the value of the last message from 'myfeed'. The actual parameters for each widget vary, you can see them by clicking on the details icons  on the widgets page.

Stay tuned for information on making your own widgets.