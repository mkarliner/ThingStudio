---
title: "Templates 4: Laying out your templates"
urlstring: "template-layout"
group: "Basics"
summary: "How to arrange your controls and widgets in a template"
---



To make it easy for you to create a beautiful, well-structured user interface for your app, we have made available for you a standard 12 column responsive grid system. As our responsive grid is based on the Materialize code base, we have leveraged and (slightly) adapted their documentation as well. Hat tip to the Materialize team and the various contributors.

##A 12 Column, Responsive Grid

Our standard grid has 12 columns. No matter the size of the viewport, each of these columns will always have an equal width. To see the grid in action, you can copy the code below in to a template and use the app viewer to see the responsive grid in action.

<pre>
&lt;div class="row"&gt;
  &lt;div class="col s1"&gt;1&lt;/div&gt;
  &lt;div class="col s1"&gt;2&lt;/div&gt;
  &lt;div class="col s1"&gt;3&lt;/div&gt;
  &lt;div class="col s1"&gt;4&lt;/div&gt;
  &lt;div class="col s1"&gt;5&lt;/div&gt;
  &lt;div class="col s1"&gt;6&lt;/div&gt;
  &lt;div class="col s1"&gt;7&lt;/div&gt;
  &lt;div class="col s1"&gt;8&lt;/div&gt;
  &lt;div class="col s1"&gt;9&lt;/div&gt;
  &lt;div class="col s1"&gt;10&lt;/div&gt;
  &lt;div class="col s1"&gt;11&lt;/div&gt;
  &lt;div class="col s1"&gt;12&lt;/div&gt;
&lt;/div&gt;
</pre>

##Creating Responsive Layouts

Above we showed you how to layout elements using our grid system. Now we'll show you how to design your layouts so that they look great on all screen sizes.

The first thing to be aware of is that you can set different column counts for different screen sizes. A common case is to have a block of content span 12 columns on small screens (), 9 columns on medium screens and 6 columns on large screens. This would be accomplished by doing the following:

<pre>
&lt;div class="row"&gt;
  &lt;div class="col s12 m9 l6"&gt;This div is 12-columns wide on small screens, 9 columns wide on medium screens, and 6 columns wide on large screens.&lt;/div&gt;
&lt;/div&gt;
</pre>

Here are the breakpoints for the various screen sizes:

* Class prefix .s = Mobile Devices (screens less than 600px wide)
* Class prefix .m = Tablet Devices (screens less than 992px wide)
* Class prefix .l = Desktop Devices (screens greater than 992px wide)

### Columns must be inside rows
Remember when you are creating your layout that all columns must be contained inside a _row_ and that you must add the _col_ class to your inner divs, in addition to a screen-size value (s = small, m = medium, l = large, plus a number 1 - 12) to make them into columns.

<pre>
&lt;div class="row"&gt;
  &lt;div class="col s12"&gt;This div is 12-columns wide&lt;/div&gt;
  &lt;div class="col s6"&gt;This div is 6-columns wide&lt;/div&gt;
  &lt;div class="col s6"&gt;This div is 6-columns wide&lt;/div&gt;
&lt;/div&gt;
</pre>

##Offsets

To start a group of columns somewhere other than the absolute left edge of your template, simply add _offset-sX_ to the class where s signifies the screen class-prefix and X signifies the number of columns by which you want to offset the content.

<pre>
&lt;div class="row"&gt;
  &lt;div class="col s12 grid-example"&gt;This div is 12-columns wide on all screen sizes&lt;/div&gt;
  &lt;div class="col s6 offset-s6 grid-example"&gt;6-columns (offset-by-6)&lt;/div&gt;
&lt;/div&gt;
</pre>
