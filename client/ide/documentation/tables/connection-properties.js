Tables.ConnectionProperties = [
	{
		name: "",
		'type': "",
		description: ""
	},
	{
		name: "Title",
		'type:': "String",
		description: "Title for the connection to be shown in lists"
	},
	{
		name: "Hostname",
		'type:': "String",
		description: "The hostname or IP address for your MQTT broker"
	},
	{
		name: "Port",
		'type:': "Number",
		description: "The port your MQTT broker is listening on for websocket connections. This is NOT 1883. Your MQTT broker must support websocket connections"
	},
	{
		name: "Protocol",
		'type:': "Select",
		description: "This can be either regular websockets or secure websockets using TLS."
	},
	{
		name: "Use Server Credentials",
		'type:': "String",
		description: "If checked, the username and password below will not be used, but users will be prompted for a username and password. Check this box if you are using an open broker"
	},
	{
		name: "Username",
		'type:': "String",
		description: "Username for access to your broker, if needed"
	},
	{
		name: "Password",
		'type:': "String",
		description: "Password for access to your broker, if needed"
	},
]