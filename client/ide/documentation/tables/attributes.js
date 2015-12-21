Tables = {};

Tables.AttributesTable = [
	{
		Name: "data-feed",
		'Publish / Subscribe': "Both",
		Description: "The name of the feed to be used, either to display data from a Subscribe feed, or to send data to, in the case of a Publish feed."
	},
	{
		Name: "data-message",
		'Publish / Subscribe': "Publish",
		description: "The payload of the message to be sent for events that have no data associated with them. For example, a button click is an event, but has no actual data to provide. Use this attribute to pass data along with the event."
	},
	{
		Name: "data-continuous",
		'Publish / Subscribe': "Publish",
		Description: "For inputs that can generate 'value changed' events (i.e. sliders), publish the events continuously as the value changes, rather than just when the mouse button is released."
	},
    {
        Name: "data-renderedFeed",
        'Publish / Subscribe': "Publish",
        Description: "The name of a feed to send a message to when this element is rendered."
    },
	{
		Name: "data-renderedMessage",
		'Publish / Subscribe': "Publish",
		description: "The payload of the message to be sent when this element is rendered"
	},
]
