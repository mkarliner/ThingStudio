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
	owner: {
		type: String,
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
	}
	
	
	
});

Feeds.attachSchema(Schemas.Feed);