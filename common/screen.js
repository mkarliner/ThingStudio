Screens = new Mongo.Collection("screens");



Schemas = {};

Schemas.Screen = new SimpleSchema({
	title: {
		type: String,
		label: "Name",
		max: 200
	},
	html: {
		type: String
	}
	
	
});

Screens.attachSchema(Schemas.Screen);