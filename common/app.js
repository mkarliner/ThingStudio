Apps = new Mongo.Collection("apps");


Schemas = {};

Schemas.App = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
		max: 200
	},
	description: {
		type: String,
		label: "Description",
		optional: true,
		autoform: {
			rows: 3
		}
	},
	owner: {
		type: String,
		index: true,
		autoform: {
			omit: true
		},
		autoValue: function(thing){
			console.log("THING ", thing)
			if(this.isInsert) {
				return Meteor.userId();
			} else if(this.isUpsert) {
				return {$setOnInsert: Meteor.userId};
			} else {
				this.unset();
			}
		}
	},
	access: {
		type: String,
		defaultValue: "Private",
		allowedValues: ["Private", "Shareable", "Published"]
	}
	
});

Apps.before.remove(function(userId, doc) {
	if(Meteor.isServer) {
		console.log("APP DESTROY");
		Connections.remove({appId: doc._id});
		Feeds.remove({appId: doc._id});
		Screens.remove({appId: doc._id});
		Themes.remove({appId: doc._id});
	}
});

Apps.attachSchema(Schemas.App);

Apps.allow({
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