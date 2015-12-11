Tables.FeedProperties = [
	{
		name: "Title",
		type: "String",
		"required?": "requred",
		description: "Title for the feed to be shown in lists"
	},
	{
		name: "Subscription",
		type: "String",
		"required?": "requred",
		description: "The MQTT topic/s that will be used with this feed. Note that the publish feeds cannot use wildcard subscriptions."
	},
	{
		name: "Publish/Subscribe",
		type: "Select",
		"required?": "requred",
		description: "Wether to use this feed for outgoing messages (publish), or incoming (subscribe)."
	},
	{
		name: "JSON Key",
		type: "String",
		"required?": "optional",
		description: "If incoming messages are JSON objects, the JSON Key selects one property (key) to use as the value of the feeds messages. So, if you have a complex object coming in and want to do averaging on just one property of the message use Json Key to select the key and check Do calculations."
	},
	{
		name: "Keep Journal",
		type: "Boolean",
		"required?": "optional",
		description: "If checked, the last 'n' messages will be kept on a first in, first out basis. This is useful for showing time series data."
	},
	{
		name: "Journal Limit",
		type: "Number",
		"required?": "optional",
		description: "If keep journal is checked, the number of messages to keep"
	},
	{
		name: "Do Calculations",
		type: "Boolean",
		"required?": "optional",
		description: "Process incoming data and create the following values: 'min', 'max', 'avg'. 'min' is the minimum value over the last 'n' values. 'max' is the maximum value over the last 'n' values. 'avg' is an exponential running average over the last 'n' values."
	}
]
