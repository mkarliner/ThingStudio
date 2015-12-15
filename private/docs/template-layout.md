---
title: "Templates 4: Laying out your templates"
urlstring: "template-layout"
group: "Basics"
summary: "How to arrange your controls and widgets in a template"
---



#Laying Out Your Templates

We are using a standard 12 column fluid responsive grid system. The grid helps you layout your page in an ordered, easy fashion. As our responsive grid is based on the Materialize code base, we have leveraged and (slightly) adapted their documentation as well. Hat tip to the Materialize team and the various contributors.

##12 Columns

Our standard grid has 12 columns. No matter the size of the browser, each of these columns will always have an equal width.

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

##Columns live inside Rows

Remember when you are creating your layout that all columns must be contained inside a row and that you must add the col class to your inner divs to make them into columns

<pre>
&lt;div class="row"&gt;
  &lt;div class="col s12"&gt;This div is 12-columns wide&lt;/div&gt;
  &lt;div class="col s6"&gt;This div is 6-columns wide&lt;/div&gt;
  &lt;div class="col s6"&gt;This div is 6-columns wide&lt;/div&gt;
&lt;/div&gt;
</pre>

##Offsets

To offset, simply add offset-s2 to the class where s signifies the screen class-prefix (s = small, m = medium, l = large) and the number after is the number of columns you want to offset by.

<pre>
&lt;div class="row"&gt;
  &lt;div class="col s12 grid-example"&gt;This div is 12-columns wide on all screen sizes&lt;/div&gt;
  &lt;div class="col s6 offset-s6 grid-example"&gt;6-columns (offset-by-6)&lt;/div&gt;
&lt;/div&gt;
</pre>

##Creating Responsive Layouts

Above we showed you how to layout elements using our grid system. Now we'll show you how to design your layouts so that they look great on all screen sizes.

Class prefix .s = Mobile Devices (screens less than 600px wide)
Class prefix .m = Mobile Devices (screens less than 992px wide)
Class prefix .l = Mobile Devices (screens greater than 992px wide)
