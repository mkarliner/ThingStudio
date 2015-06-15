Screens = new Mongo.Collection("screens");


boilerplate = Screens.findOne({title: "VerySpecialSecretBoilerPlateScreen"});

if(boilerplate) {
	defaultScreenContent = boilerplate.html;
} else {
	defaultScreenContent = "<!-- Screen content here -->";
}

if(boilerplate) {
	defaultJsContent = boilerplate.js;
	console.log("DEFCON: ",boilerplate, defaultJsContent);
} else {
	defaultJsContent = "//Javascript content here";
}

// Schemas = {};

SimpleSchema.messages({
	"regEx widgetName": "Widget names must contain a - character"
})

Schemas.WidgetParameter = new SimpleSchema({
	title: {
		type: String,
	},
	mandatory: {
		type: Boolean
	},
	description: {
		type: String
	}
})

Schemas.Screen = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
		max: 200
	},
	// tags: {
	// 	type: [String],
	// 	index: true,
	// 	optional: true
	// },
	theme: {
		type: String,
		optional: true,
		autoform: {
			type: "select",
			options: function(){
				themes = Themes.find({}).fetch();
				options = [];
				var i;
				for(i=0; i<themes.length; i++) {
					options[i] = { label: themes[i].title, value: themes[i]._id};
				}
				return(options);
			}
		}
	},
	html: {
		label: " ",
		type: String,
		autoform: {
			rows: 10,
	        afFieldInput: {
	          type: 'ace',
	          class: 'editor' // optional
	          // summernote options goes here
	        }
		},
		defaultValue: defaultScreenContent
	},
	js: {
		optional: true,
		label: "Javascript",
		type: String,
		autoform: {
			rows: 10,
	        afFieldInput: {
	          type: 'acejs',
	          class: 'editor' // optional
	          // summernote options goes here
	        }
		},
		defaultValue: defaultJsContent
	},
	owner: {
		type: String,
		index: true,
		autoform: {
			omit: true
		},
		autoValue: function(){
			if(this.isInsert) {
				return Meteor.userId();
			} else if(this.isUpsert) {
				return {$setOnInsert: Meteor.userId};
			} else {
				this.unset();
			}
		}
	},
	appId: {
		type: String,
		index: true,
		autoform: {
			omit: true
		},
	},
	isWidget: {
		type: Boolean,
		index: true,
		defaultValue: false
	},
	widgetName: {
		type: String,
		optional: true,
		regEx: /^[a-zA-Z_]+-[a-zA-Z_]+$/,
	},
	widgetInstructions: {
		type: String,
		optional: true,
		autoform: {
			rows: 10
		}
	},
	widgetParameters: {
		type: [Schemas.WidgetParameter],
		optional: true,
		autoform: {
			minCount: 0,
			initialCount: 0
		}
	}
	// public: {
	// 	type: Boolean,
	// 	defaultValue: false
	// }
//
	
});

Screens.before.insert(function(userId, doc) {
	if(Meteor.isClient) {
		// console.log("BEFOREHOOK ", userId, doc, Session.get("currentApp"));
		doc.appId = Session.get("currentApp")._id;
	}
});


Screens.after.update(function(userId, doc) {
	if(Meteor.isClient){
		console.log("ASUU", this,  doc)
		myscreen = doc;
		name = myscreen.title;
		// console.log("SCR: ", name, this)
		// template = this.template;
		delete Template[name]; //Remove the existing template instance.
		//console.log("Updated Screen", template.data.doc.html);
		compret = compileTemplate(name, doc.html, doc.js);
	}
});




Screens.attachSchema(Schemas.Screen);

Screens.allow({
	insert: function(userId, doc) {
		return (userId && doc.owner === userId);
	},
	update: function(userId, doc) {
		return (userId && doc.owner === userId);
	},
	remove: function(userId, doc) {
		return (userId && doc.owner === userId);
	}
});


