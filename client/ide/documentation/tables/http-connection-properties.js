Tables.HTTPConnectionProperties = [
	{
		name: "Title",
		'type:': "String",
		description: "Title for the connection to be shown in lists"
	},
	{
		name: "Hostname",
		'type:': "String",
		description: "The hostname or IP address for your web service"
	},
	{
		name: "Port",
		'type:': "Number",
		description: "The port your webs service is listening on for http connections. Default port 80"
	},
	{
		name: "Protocol",
		'type:': "Select",
		description: "This can be either http or https."
	},
	{
		name: "Username",
		'type:': "String",
		description: "Username for http basic auth or feed processing"
	},
	{
		name: "Password",
		'type:': "String",
		description: "Password for for http basic auth or feed processing"
	},
]