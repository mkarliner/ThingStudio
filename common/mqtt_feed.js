Feeds = new Mongo.Collection("feeds");

SimpleSchema.messages({
  "uniqueFeed": "Title must be unique",
  "noPublicWildcard": "Wildcard feeds cannot be public"
});

// Schemas = {};

Schemas.Feed = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
		custom: function () {
			console.log(this.userId);
			//First try to find my own duplicate.
			//f = Feeds.findOne({title: this.value, $or: [{owner: this.userId, appId: this.appId}, {public:true}]});
			if(Meteor.isClient) {
				f = Feeds.findOne({title: this.value});
				//console.log("CKF ", typeof f, this);
				if(typeof f == "object"  && this.isInsert) {
					//console.log("BOO")
					return "uniqueFeed";
				}
				if(typeof f == "object" && f._id != this.docId) {
					//console.log("Baa")
					return "uniqueFeed";
				}
				//console.log("ALLOK")
			}

			return;
		},
		max: 200
	},
	subscription: {
		type: String,
    label: "Topic"
	},
	jsonKey: {
    label: "JSON Key",
    type: String,
		optional: true
	},
	pubsub: {
		type: String,
		label: "Publish/Subscribe",
		autoform: {
			type: "selectize",
			options: function(){
				options = [{label: "Publish", value: "Publish"}, {label: "Subscribe", value: "Subscribe"}];
				return (options);
			}
		}
	},
	// action: {
	// 	type: String,
	// 	allowedValues:[ "Update"],
	// 	defaultValue: "Update"
	// },
	doJournal: {
		type: Boolean,
		defaultValue: false,
		label: "Keep Journal"
	},
	journal_limit: {
		type: Number,
		optional: true,
		defaultValue: 50
	},
	journal: {
		type: [Object],
		optional: true,
		autoform: {
			omit: true
		}
	},
	doMaxMinAvg: {
		type: Boolean,
		defaultValue: false,
		label: 'Do Calculations'
	},
	maxMinAvgLimit: {
		type: Number,
		optional: true,
		defaultValue: 50
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
	createdAt: {
		type: Date,
		autoform: {
			omit: true
		},
		autoValue: function() {
			if (this.isInsert) {
				return new Date;
			} else if (this.isUpsert) {
				return {$setOnInsert: new Date};
			} else {
				this.unset();
			}
		}
	}
	// public: {
	// 	type: Boolean,
	// 	defaultValue: false,
	// 	custom: function(){
	// 		if(this.field("subscription").value.indexOf("#") > 0 && this.value == true) {
	// 			return "noPublicWildcard";
	// 		}
	// 		if(this.field("subscription").value.indexOf("+") > 0 && this.value == true) {
	// 			return "noPublicWildcard";
	// 		}
	// 		f = Feeds.findOne({title: this.field("title").value});
	// 		// console.log("PUBCK", this.field("title"), f);
	// 		if(f && this.value == true) {
	// 			return "uniqueFeed";
	// 		}
	// 	}
	// }



});


Feeds.before.insert(function(userId, doc) {
	if(Meteor.isClient) {
		console.log("BEFOREFEEDINHOOK ", userId, doc, Session.get("currentApp"));
		doc.appId = Session.get("currentApp")._id;
	} else {
		app = Apps.findOne(doc.appId);
		if(app.owner != doc.owner) {
			console.log("Attempt to create connection in someone else's app.")
			return false;
		}
	}
});



Feeds.after.insert(function(userId, doc) {
				console.log("Feed insert after", userId, doc, Meteor.isClient)
	if(Meteor.isClient){
		if(doc.pubsub != "Publish") {
			// console.log("Feed insert subscription", userId, doc)
			topic = mqttregex(doc.subscription).topic;
			topic = topic.substring(0, topic.length - 1);
			 mqttClientSubscribe(topic);
		}
    sAlert.success( "MQTT Feed created.", { onRouteClose: false } );
    Router.go( "Feeds" )
	}
});

Feeds.after.update(function(userId, doc) {
	if(Meteor.isClient){
		// console.log("Feed update", userId, doc)
		if(doc.pubsub != "Publish") {
			topic = mqttregex(doc.subscription).topic;
			topic = topic.substring(0, topic.length - 1);
			 mqttClientSubscribe(topic);
		}
    sAlert.success( 'MQTT Feed updated.', { onRouteClose: false } );
    Router.go( "Feeds" )
	}
});

Feeds.after.remove(function(userId, doc) {
	if(Meteor.isClient){
		// console.log("Feed remove", userId, doc)
		if(doc.pubsub != "Publish") {
			topic = mqttregex(doc.subscription).topic;
			topic = topic.substring(0, topic.length - 1);
			 mqttClientUnsubscribe(topic);
		}
    sAlert.success( "MQTT Feed deleted." );
	}
});

Feeds.attachSchema(Schemas.Feed);

Feeds.allow({
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
