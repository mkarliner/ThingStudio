Tables.HTTPFeedProperties = [
	{
		Name: "Title",
		Type: "String",
		"Required?": "requred",
		Description: "Title for the feed."
	},
	{
		Name: "Connection",
		Type: "Select",
		"Required?": "requred",
		Description: "The connection to use for this feed."
	},
	{
		Name: "Path",
		Type: "String",
		"Required?": "requred",
		Description: "The URL path for this feed. Include leading slash (/) for path."
	},
	{
		Name: "Verb",
		Type: "Select",
		"Required?": "requred",
		Description: "GET, POST, etc."
	},
	{
		Name: "Polling interval",
		Type: "String",
		"Required?": "optional",
		Description: "How often to poll this feed, in seconds. Zero means DO NOT poll."
	},
	{
		Name: "Request Processor",
		Type: "Select",
		"Required?": "requred",
		Description: "Which request processor to use to format the outgoing request. Use JSONOut as a default."
	},
	{
		Name: "Response Processor",
		Type: "Select",
		"Required?": "requred",
		Description: "Which response processor to use to format the incoming response. Use JSONIn as a default."
	}
]
