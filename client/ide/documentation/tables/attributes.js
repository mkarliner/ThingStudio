Tables = {};

Tables.AttributesTable = [
	{
		name: "",
		'publish/subscribe:': "",
		description: ""
	},
	{
		name: "data-feed",
		'publish/subscribe:': "Both",
		description: "The name of the feed to be used, either to display data from a subscription feed, \
		or to send data to, in the case of a publish feed."
	},
	{
		name: "data-message",
		'publish/subscribe:': "Publish",
		description: "Message to be sent for events that have no data associate with them, ie: button click"
	},
	{
		name: "data-continuous",
		'publish/subscribe:': "Publish",
		description: "For inputs that can generated 'value changed' events, publish the events continuously\
		as the value changes, rather than just when the mouse button is released."
	},
]