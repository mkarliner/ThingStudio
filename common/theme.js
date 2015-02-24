Themes = new Mongo.Collection("themes");




Schemas = {};

Schemas.Theme = new SimpleSchema({
	title: {
		type: String,
		label: "Name",
		max: 200
	},
	css: {
		type: String,
		autoform: {
			rows: 10,
	        afFieldInput: {
	          type: 'acecss',
	          class: 'editor' // optional
	          // summernote options goes here
	        }
		}
	}
	
	
});

Themes.attachSchema(Schemas.Theme);