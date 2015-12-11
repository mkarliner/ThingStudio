Tables.ConnectionProperties = [
	{
		name: "Title",
		type: "String",
		"required?": "required",
		description: "Title for the connection."
	},
	{
		name: "Hostname",
		type: "String",
		"required?": "required",
		description: "The hostname or IP address for your MQTT broker."
	},
	{
		name: "Port",
		type: "Number",
		"required?": "required",
		description: "The port your MQTT broker is listening on for WEBSOCKET connections. This is NOT 1883. Your MQTT broker MUST support websocket connections."
	},
	{
		name: "Protocol",
		type: "Select",
		"required?": "required",
		description: "This can be either regular websockets or secure websockets using TLS."
	},
	{
		name: "Use Server Credentials",
		type: "String",
		"required?": "optional",
		description: "If checked, the username and password below will be used to authenticate with the MQTT broker, AND stored on the ThingStudio servers. This is obviously INSECURE and NOT RECOMMENDED for production. If unchecked, users will be prompted for a username and password each time they bring up the app viewer. You probably want to check this box if you are using an open broker to avoid the credentials form."
	},
	{
		name: "Username",
		type: "String",
		"required?": "optional",
		description: "Username to access your broker, if needed."
	},
	{
		name: "Password",
		type: "String",
		"required?": "optional",
		description: "Password to access your broker, if needed."
	},
]
