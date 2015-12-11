Tables.HTTPConnectionProperties = [
	{
		name: "Title",
		type: "String",
		"required?": "requred",
		description: "Title for the connection."
	},
	{
		name: "Hostname",
		type: "String",
		"required?": "requred",
		description: "The hostname or IP address for your web service."
	},
	{
		name: "Port",
		type: "Number",
		"required?": "requred",
		description: "The port your web service is listening on for HTTP connections. Default port 80."
	},
	{
		name: "Protocol",
		type: "Select",
		"required?": "requred",
		description: "This can be either HTTP or HTTPS."
	},
	{
		name: "Username",
		type: "String",
		"required?": "optional",
		description: "Username for HTTP basic auth or feed processing."
	},
	{
		name: "Password",
		type: "String",
		"required?": "optional",
		description: "Password for HTTP basic auth or feed processing."
	},
]
