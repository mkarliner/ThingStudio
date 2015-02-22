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
			rows: 10,
	        afFieldInput: {
	          type: 'ace',
	          class: 'editor' // optional
	          // summernote options goes here
	        }
		}
	}
	
	
});

Screens.attachSchema(Schemas.Screen);


