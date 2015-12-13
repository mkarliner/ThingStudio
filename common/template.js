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
	lowercaseTitle: {
		type: String,
		optional: true,
		max: 200,
		autoform: {
			omit: true
		}
	},
	summary: {
		type: String,
		label: "Summary",
		optional: true,
		max: 100
	},
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
    }
});

Screens.before.insert(function(userId, doc) {
	if(Meteor.isClient) {
		// console.log("BEFOREHOOK ", userId, doc, Session.get("currentApp"));
		doc.appId = Session.get("currentApp")._id;
		doc.lowercaseTitle = doc.title.toString().toLowerCase()
	} else {
		app = Apps.findOne(doc.appId);
		if(app.owner != doc.owner) {
			console.log("Attempt to create connection in someone else's app.")
			return false;
		}
	}
});

Screens.after.insert(function (userId, doc) {
	if( Meteor.isClient ){
		sAlert.success( "Template created.", { onRouteClose: false } );
		Router.go('Edit Template', {_id: doc._id});
	}
})

Screens.before.update(function (userId, doc, fieldNames, modifier, options) {
	if(Meteor.isClient) {
		modifier.$set.lowercaseTitle = doc.title.toString().toLowerCase()
		// console.log("Here is the modifier: ", modifier)
	}
})

Screens.after.update(function(userId, doc, fieldNames, modifier, options) {
	if(Meteor.isClient){
		//console.log("ASUU", userId, this,  doc)
		myscreen = doc;
		name = myscreen.title;
		// console.log("SCR: ", name, this)
		// template = this.template;
		delete Template[name]; //Remove the existing template instance.
		//console.log("Updated Screen", template.data.doc.html);
		compret = compileTemplate(name, doc.html, doc.js);
		// Alerts.insert(compret);
		//Track on google analytics, if not admin
		user = Meteor.users.findOne({_id: userId});
		if(user.roles == undefined) {
			console.log("GAUS: ", doc.title)
			analytics.track("Update Template", {
			  Title: doc.title,
			  Username: user.username,
			});
		}
		sAlert.success( "Template updated.", { timeout: 1500 } );
	}
	if(Meteor.isServer) {
        //console.log("SCRUOP: ", doc,userId, fieldNames, modifier, options);
		SysLogs.upsert({event: "ScreenUpdate", id: doc._id},
		{$set:
				{
					event: "ScreenUpdate",
					title: doc.title,
					date: new Date(),
                    userName: Meteor.users.findOne({_id: doc.owner}).username,
					id: doc._id,
					appId: doc.appId,
					owner: doc.owner,
				},
			$inc:
				{
					count: 1
				}
			})
	}
});

Screens.after.remove( function(userId, doc) {
	if(Meteor.isClient){
    sAlert.success( "Templated deleted." );
	}
});


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
