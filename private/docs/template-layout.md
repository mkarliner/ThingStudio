---
title: "Laying out your templates"
urlstring: "template-layout"
group: "Basics"
summary: "How to arrange your controls and widgets in a template"
---



#Laying Out Your Templates

We are using a standard 12 column fluid responsive grid system. The grid helps you layout your page in an ordered, easy fashion. As our responsive grid is based on the Materialize code base, we have leveraged and (slightly) adapted their documentation as well. Hat tip to the Materialize team and the various contributors.

##12 Columns

Our standard grid has 12 columns. No matter the size of the browser, each of these columns will always have an equal width.

<code>
  <div class="row">
    <div class="col s1">1</div>
    <div class="col s1">2</div>
    <div class="col s1">3</div>
    <div class="col s1">4</div>
    <div class="col s1">5</div>
    <div class="col s1">6</div>
    <div class="col s1">7</div>
    <div class="col s1">8</div>
    <div class="col s1">9</div>
    <div class="col s1">10</div>
    <div class="col s1">11</div>
    <div class="col s1">12</div>
  </div>
</code>

##Columns live inside Rows

Remember when you are creating your layout that all columns must be contained inside a row and that you must add the col class to your inner divs to make them into columns

<code>
  <div class="row">
    <div class="col s12">This div is 12-columns wide</div>
    <div class="col s6">This div is 6-columns wide</div>
    <div class="col s6">This div is 6-columns wide</div>
  </div>
</code>

##Offsets

To offset, simply add offset-s2 to the class where s signifies the screen class-prefix (s = small, m = medium, l = large) and the number after is the number of columns you want to offset by.

<code>
  <div class="row">
    <div class="col s12 grid-example"><span class="flow-text">This div is 12-columns wide on all screen sizes</span></div>
    <div class="col s6 offset-s6 grid-example"><span class="flow-text">6-columns (offset-by-6)</span></div>
  </div>
</code>

##Creating Responsive Layouts

Above we showed you how to layout elements using our grid system. Now we'll show you how to design your layouts so that they look great on all screen sizes.

Class prefix .s = Mobile Devices (screens less than 600px wide)
Class prefix .m = Mobile Devices (screens less than 992px wide)
Class prefix .l = Mobile Devices (screens greater than 992px wide)

