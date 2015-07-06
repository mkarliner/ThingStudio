Themes = new Mongo.Collection("themes");

Schemas.Theme = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
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
});

Themes.before.insert(function(userId, doc) {
	if(Meteor.isClient) {
		// console.log("BEFOREHOOK ", userId, doc, Session.get("currentApp"));
		if(!doc.css) {
			doc.css = "#Insert CSS here"
		}
		doc.appId = Session.get("currentApp")._id;
	}
});

Themes.attachSchema(Schemas.Theme);

Themes.allow({
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