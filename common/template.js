Screens = new Mongo.Collection("screens");


boilerplate = Screens.findOne({title: "VerySpecialSecretBoilerPlateScreen"});

if(boilerplate) {
	defaultScreenContent = boilerplate.html;
} else {
	defaultScreenContent = "<!-- Screen content here -->";
}

if(boilerplate) {
	defaultJsContent = boilerplate.js;
	//console.log("DEFCON: ",boilerplate, defaultJsContent);
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
		defaultValue: '',
		optional: true,
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
	},
    updatedAt: {
      type: Date,
      autoValue: function() {
        if (this.isUpdate) {
          return new Date();
        }
      },
      denyInsert: true,
      optional: true
    },
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
	} else {
		app = Apps.findOne(doc.appId);
		if(app.owner != doc.owner) {
			console.log("Attempt to create connection in someone else's app.")
			return false;
		}
	}
});


Screens.after.update(function(userId, doc) {
	if(Meteor.isClient){
		//console.log("ASUU", this,  doc)
		myscreen = doc;
		name = myscreen.title;
		// console.log("SCR: ", name, this)
		// template = this.template;
		delete Template[name]; //Remove the existing template instance.
		//console.log("Updated Screen", template.data.doc.html);
		compret = compileTemplate(name, doc.html, doc.js);
		Alerts.insert(compret);
		//Track on google analytics, if not admin
		user = Meteor.users.findOne({_id: userId});
		if(user.roles == undefined) {
			console.log("GAUS: ", doc.title)
			analytics.track("Update Template", {
			  Title: doc.title,
			  Username: user.username,
			});
		}
	}
	if(Meteor.isServer) {
		SysLogs.upsert({event: "ScreenUpdate", id: doc._id},
		{$set:
				{
					event: "ScreenUpdate",
					title: doc.title,
					date: new Date(),
					id: doc._id,
					appId: doc.appId,
					owner: doc._owner,
				},
			$inc:
				{
					count: 1
				}
			})
	}
});

Screens.after.insert(function (userId, doc) {
	if(Meteor.isClient){
		Router.go('Edit Template', {_id: doc._id});
	}
})

Screens.attachSchema(Schemas.Screen);

Screens.allow({
	insert: function(userId, doc) {
		return (userId && doc.owner === userId);
	},
	update: function(userId, doc) {
		return (userId && doc.owner === userId || isAdmin(userId));
	},
	remove: function(userId, doc) {
		return (userId && doc.owner === userId || isAdmin(userId));
	}
});
