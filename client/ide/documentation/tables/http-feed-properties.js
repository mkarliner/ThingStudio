Tables.HTTPFeedProperties = [
	{
		name: "Title",
		type: "String",
		"required?": "requred",
		description: "Title for the feed."
	},
	{
		name: "Connection",
		type: "Select",
		"required?": "requred",
		description: "The connection to use for this feed."
	},
	{
		name: "Path",
		type: "String",
		"required?": "requred",
		description: "The URL path for this feed. Include leading slash (/) for path."
	},
	{
		name: "Verb",
		type: "Select",
		"required?": "requred",
		description: "GET, POST, etc."
	},
	{
		name: "Polling interval",
		type: "String",
		"required?": "optional",
		description: "How often to poll this feed, in seconds. Zero means DO NOT poll."
	},
	{
		name: "Request Processor",
		type: "Select",
		"required?": "requred",
		description: "Which request processor to use to format the outgoing request. Use JSONOut as a default."
	},
	{
		name: "Response Processor",
		type: "Select",
		"required?": "requred",
		description: "Which response processor to use to format the incoming response. Use JSONIn as a default."
	}
]
