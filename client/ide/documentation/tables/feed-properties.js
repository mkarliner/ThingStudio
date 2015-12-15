Tables.FeedProperties = [
	{
		Name: "Title",
		Type: "String",
		"Required?": "requred",
		Description: "Title for the feed to be shown in lists"
	},
	{
		Name: "Subscription",
		Type: "String",
		"Required?": "requred",
		Description: "The MQTT topic(s, if using wildcards) that will be used with this feed. Note that publish feeds cannot use wildcard topics."
	},
	{
		Name: "Publish/Subscribe",
		Type: "Select",
		"Required?": "requred",
		Description: "Use this feed for outgoing messages (publish), or incoming messages (subscribe)."
	},
	{
		Name: "JSON Key",
		Type: "String",
		"Required?": "optional",
		Description: "If incoming messages are JSON objects, the JSON Key selects one property (key) to use as the value of the feeds messages. So, if you have a complex object coming in and want to do averaging on just one property of the message use JSON Key to select the key and check 'Do Calculations', specifying how many values to use for the calulation."
	},
	{
		Name: "Keep Journal",
		Type: "Boolean",
		"Required?": "optional",
		Description: "If checked, the last 'n' messages will be kept on a first in, first out basis. This is useful for showing time series data. The value for 'n' is defined in the accompanying text field."
	},
	// {
	// 	Name: "Journal Limit",
	// 	Type: "Number",
	// 	"Required?": "optional",
	// 	Description: "If keep journal is checked, the number of messages to keep."
	// },
	{
		Name: "Do Calculations",
		Type: "Boolean",
		"Required?": "optional",
		Description: "Process incoming data and create the following values: 'min', 'max', 'avg'. 'min' is the minimum value over the last 'n' values. 'max' is the maximum value over the last 'n' values. 'avg' is an exponential running average over the last 'n' values. The value for 'n' is defined in the accompanying text field."
	}
]
