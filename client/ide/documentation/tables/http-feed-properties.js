Tables.HTTPFeedProperties = [
	{
		name: "Title",
		'type:': "String",
		description: "Title for the feed to be shown in lists"
	},
	{
		name: "Connection",
		'type': "Select",
		description: "The connection to use for this feed"
	},
	{
		name: "Path",
		'type:': "String",
		description: "The URL path for this feed. Use a leading / "
	},
	{
		name: "Verb",
		'type:': "Select",
		description: "GET, POST, etc"
	},
	{
		name: "Polling interval",
		type: "String",
		description: "How often to poll this feed in seconds. Zero means do not poll"
	},
	{
		name: "Request Processor",
		'type:': "Select",
		description: "Which request processor to use to format the outgoing request. Use JSON out as a default"
	},
	{
		name: "Response Processor",
		'type:': "Select",
		description: "Which response processor to use to format the incoming response. Use JSON in as a default"
	}
]