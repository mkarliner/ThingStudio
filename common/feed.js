Feeds = new Mongo.Collection("feeds");



Schemas = {};

Schemas.Feed = new SimpleSchema({
	title: {
		type: String,
		label: "Name",
		max: 200
	},
	subscription: {
		type: String,

	},
	action: {
		type: String,
		allowedValues:["Log", "Update"],
		defaultValue: "Update"
	},
	
	
	
});

Feeds.attachSchema(Schemas.Feed);