Tables.FeedProperties = [
	{
		name: "Title",
		'type:': "String",
		description: "Title for the feed to be shown in lists"
	},
	{
		name: "Subscription",
		'type:': "String",
		description: "The MQTT topic/s that will be used with this feed. Note that the publish feeds cannot use wildcard subscriptions"
	},
	{
		name: "Publish/Subscribe",
		'type:': "Select",
		description: "Wether to use this feed for outgoing messages (publish), or incoming (subscribe)"
	},
	{
		name: "Json Key",
		type: "String",
		description: "If incoming messages are JSON objects, the Json Key selects one property (key) to use as the value of the feeds messages. So, if you have a complex object coming in and want to do averaging on just one property of the message use Json Key to select the key and check Do calculations. "
	},
	{
		name: "Keep Journal",
		'type:': "Boolean",
		description: "If checked, the last 'n' messages will be kept on a first in, first out basis. This is useful for showing time series data."
	},
	{
		name: "Journal Limit",
		'type:': "Number",
		description: "If keep journal is checked, the number of messages to keep"
	}
]