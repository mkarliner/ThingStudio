


Tables.HelpersTable = [
	{
		name: "",
		params: "",
		description: ""
	},
	{
		name: "message",
		params: "feedname",
		description: "Returns the payload of the last message on the named feed"
	},
	{
		name: "messages",
		params: "feedname",
		description: "Returns all messages from a given feed. This is mainly used with feeds that have wildcard subscriptions"
	},
	{
		name: "journal",
		params: "feedname",
		description: "Return the last 'n' messages of a journalled feed. The feed's feed limit property specifies 'n';"
	},
	{
		name: "indexedArray",
		params: "Array",
		description: "Returns an array of objects with key and value properties. This is useful for interating over arrays of values in display widgets"
	},
	{
		name: "feedmatch",
		params: "tag",
		description: "Extracts the message that matches the tag in a feed's wildcard subscription"
	},
	{
		name: "username",
		params: "none",
		description: "Returns the current user's name or 'anonymous' "
	}
];



