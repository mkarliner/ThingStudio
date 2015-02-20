Screens = new Mongo.Collection("screens");



Schemas = {};

Schemas.Screen = new SimpleSchema({
	title: {
		type: String,
		label: "Name",
		max: 200
	},
	html: {
		type: String,
		autoform: {
			rows: 10
		}
	}
	
	
});

Screens.attachSchema(Schemas.Screen);