 

ThingStudio

TODO List

Name and password for connection
Secure connections.

# Usage

## Connections
Connections construct a connection to an MQTT  broker.
At the moment there can be only one active connection at a time.

## Feeds
Feeds represent subscriptions to one or more MQTT topics and how
to treat data that is emitted by them. The subscription field is 
the normal MQTT topic subscription and may include the wildcard characters
"+" and "#", see MQTT documentation for details.

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
There are currently two helpers:

#### messages <feedname>
The messages helper returns an array of messages from feedname.
The messages a object with the following JASON format.

{
	feed: <the feed name>
	topic: <the name of the topic that sent the message>
	message: < the body of the message>
}

#### message <feedname>
	Returns the body of the first message from the feed.
	
###Sending data
ThingStudio templates use 'data' suffixed attributes to indicate
which feeds should be updated. There are current two attributes:

data-feed: <the name of the feed to be updated>
data-message: < the message to send (buttons only)>

In the case of controls with a 'value' attribute, the value
is sent as the message.

##Themes
Themes specify CSS that should be applied to the rendering of screens.
