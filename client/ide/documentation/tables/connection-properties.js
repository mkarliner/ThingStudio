Tables.ConnectionProperties = [
	{
		Name: "Title",
		Type: "String",
		"Required?": "required",
		Description: "Title for the connection."
	},
	{
		Name: "Hostname",
		Type: "String",
		"Required?": "required",
		Description: "The hostname or IP address for your MQTT broker."
	},
	{
		Name: "Port",
		Type: "Number",
		"Required?": "required",
		Description: "The port your MQTT broker is listening on for WEBSOCKET connections. This is NOT 1883. Your MQTT broker MUST support websocket connections."
	},
	{
		Name: "Protocol",
		Type: "Select",
		"Required?": "required",
		Description: "This can be either regular websockets or secure websockets using TLS."
	},
	{
		Name: "Use Server Credentials",
		Type: "String",
		"Required?": "optional",
		Description: "If checked, the username and password below will be used to authenticate with the MQTT broker, AND stored on the ThingStudio servers. This is obviously INSECURE and NOT RECOMMENDED for production. If unchecked, users will be prompted for a username and password each time they bring up the app viewer. You probably want to check this box if you are using an open broker to avoid the credentials form."
	},
	{
		Name: "Username",
		Type: "String",
		"Required?": "optional",
		Description: "Username to access your broker, if needed."
	},
	{
		Name: "Password",
		Type: "String",
		"Required?": "optional",
		Description: "Password to access your broker, if needed."
	},
]
