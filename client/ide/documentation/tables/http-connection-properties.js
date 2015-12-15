Tables.HTTPConnectionProperties = [
	{
		Name: "Title",
		Type: "String",
		"Required?": "requred",
		Description: "Title for the connection."
	},
	{
		Name: "Hostname",
		Type: "String",
		"Required?": "requred",
		Description: "The hostname or IP address for your web service."
	},
	{
		Name: "Port",
		Type: "Number",
		"Required?": "requred",
		Description: "The port your web service is listening on for HTTP connections. Default port 80."
	},
	{
		Name: "Protocol",
		Type: "Select",
		"Required?": "requred",
		Description: "This can be either HTTP or HTTPS."
	},
	{
		Name: "Username",
		Type: "String",
		"Required?": "optional",
		Description: "Username for HTTP basic auth or feed processing."
	},
	{
		Name: "Password",
		Type: "String",
		"Required?": "optional",
		Description: "Password for HTTP basic auth or feed processing."
	},
]
