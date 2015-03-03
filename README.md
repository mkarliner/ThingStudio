 

ThingStudio

TODO List

Name and password for connection
Secure connections.

# Usage


## Modes
ThingStudio has two modes, viewer and studio.
When you login, you will be put into the viewer menu,
this will give you buttons to view your screens, or to
go to studio mode, where you can edit your connections, feeds
screens and themes.

## Connections
Connections construct a connection to an MQTT  broker.
At the moment there can be only one active connection at a time.

## Feeds
Feeds represent subscriptions to one or more MQTT topics and how
to treat data that is emitted by them. The subscription field is 
the normal MQTT topic subscription and may include the wildcard characters
"+" and "#", see MQTT documentation for details. Additionally, subscriptions
may have a "tag" appended to the a "+" or "#" character, this will server
to extract the matching field(s) when display data, see "feedmatch" below.

The "action" field indicates how to treat the messages from the subscription.
"Update" means that each message replaces any messages from the same topic,
or creates a new entry if there was none before. Note that when using wildcard
subscriptions, a feed may produce more than one entry. Thus: a subscription of

temperature/+room will match temperature/front_room and temperature/back_room,
we will see how to handle this in the screens section.

##Screens

Screens are simple html templates that also specified how data
from feeds will be rendered and what messages to send to feeds 
when data is entered on a input or a button is clicked.

### Displaying data.
ThingStudio uses Meteor "Spacebars" templates, which are based on 
Moustache templates. {{ helpername params }} means insert dynamic data
into the DOM using the helper helpername with optional parameters.
There are currently three helpers:

#### messages <feedname>
The messages helper returns an array of messages from feedname.
The messages a object with the following JASON format.
<pre>
{
	feed: <the feed name>
	topic: <the name of the topic that sent the message>
	message: < the body of the message>
}
</pre>

#### message <feedname>
	Returns the body of the first message from the feed.
	
#### feedmatch <feedname> <tag>
	When display multiple messages using a handlebars
	#each loop, you may want to extract the part of the
	topic that is unique to each message. For this you 
	use the feedmatch helper. An example will make it clear.
	If a feed subscription looks like this: 
	`/temperatures/#place`, and messages are being sent to the
 	topics `/temperatures/back_room` and `/temperatures/front_room`
	then this template code
	
<pre>
    {{#each messages "temps"}}
       <tr><td>{{feedmatch "temps" "place"}}</td><td> {{this.message}}</td></tr>
    {{/each}}
</pre>

  will output table rows with the content 
<pre>
  back_room 20.5
  front_room 19.2
</pre>

##Elements

####Rail Slider
    <pre>
	    <input class="knob-slider" id="sliderID" type="range" name="insert a value" min="0" max="100" value="{{message "message name here"}}">
    </pre>

####Fat Slider
<pre>
	<input class="servo-slider" id="sliderID" type="range" name="insert a value" min="0" max="100" value="{{message "message name here"}}">
</pre>

####Checkbox
<pre>
	<div class="checkbox">
		<input id="remember-me" type="checkbox" class="image-checkbox"/>    
		<label for="remember-me" class="image-checkbox-label"></label>
    </div>
</pre>

####iOS Switch
Add an iOS style switch
<pre>
	<label>
		<input type="checkbox" class="ios-switch green  bigswitch" checked />
        	<div>
	            <div></div>
      		</div>
    </label>
</pre>

####Binary Value + Icon

<pre>
	<div class="lightOutput binary-{{message "kitchenLight"}}">
      		<i class="fa fa-lightbulb-o"></i>
    	</div>
</pre>

####Status button (using Bootstrap classes for style)

<pre>
	<span class="btn status-button btn-{{message "ImportantStatus1"}}">Hull</span>
</pre>

####Progress bar

<pre>
	<div class="progress">
		<div class="progress-bar" role="progressbar" aria-valuenow="70" aria-valuemin="0" aria-valuemax="100" style="width:{{message "PercentFill"}}%">
    			{{message "PercentFill"}}%
        	</div>
    </div>
</pre>
	
#### Initial Values
It's important to remember that controls linked to incoming fields may not have 
a value until the first message that comes from MQTT, and this may have
an unwanted effect on the UI. There are two ways round this.
- Give the contol and initial value by setting the value attribute.
- Configure your MQTT broker to provide the last good value upon subscription.
Assuming that you can afford the memory implications, the latter is the preferable
course, as you will have live data immediately.
	
###Sending data
ThingStudio templates use 'data' suffixed attributes to indicate
which feeds should be updated. There are current two attributes:

data-feed: <the name of the feed to be updated>
data-message: < the message to send (buttons only)>

In the case of controls with a 'value' attribute, the value
is sent as the message.

##Themes
Themes specify CSS that should be applied to the rendering of screens.

# Custom control templates.
We provide a set of custom controls that can be rendered by using an include 
template directive like this {{> mytemplate }}

|Name|Appearance|Functionality|Parameters|
|iosSwitch|IOS style toggle switch|checkbox|color, size, feed, initialState|
