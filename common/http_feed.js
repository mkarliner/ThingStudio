HTTPFeeds = new Mongo.Collection("http_feeds");

SimpleSchema.messages({
  "uniqueFeed": "Title must be unique",
  "noPublicWildcard": "Wildcard feeds cannot be public"
});

// Schemas = {};

Schemas.HTTPFeed = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
		custom: function () {
			console.log(this.userId);
			//First try to find my own duplicate.
			//f = HTTPFeeds.findOne({title: this.value, $or: [{owner: this.userId, appId: this.appId}, {public:true}]});
			if(Meteor.isClient) {
				f = HTTPFeeds.findOne({title: this.value});
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
	connection: {
		type: String,
		optional: true,
		autoform: {
			type: "selectize",
			options: function(){
				connections = HTTPConnections.find({}).fetch();
				options = [];
				var i;
				for(i=0; i<connections.length; i++) {
					options[i] = { label: connections[i].title, value: connections[i]._id};
				}
				return(options);
			}
		}
	},
	path: {
		type: String,

	},
	jsonKey: {
		type: String,
		optional: true
	},
	
	verb: {
		type: String,
		allowedValues: ["GET", "POST", "PUT", "DELETE"],
		autoform: {
			type: "selectize",
			options: function(){
				options = [{label: "GET", value: "GET"}, {label: "POST", value: "POST"}, {label: "PUT", value: "PUT"}, {label: "DELETE", value: "DELETE"}];
				return (options);
			}
		},
		defaultValue: "GET"
	},
	
	polling_interval: {
		type: Number,
		defaultValue: 0
	},
	
	requestProcessor: {
		type: String,
		autoform: {
					type: "selectize",
					options: function(){
						console.log("asdf", FeedProcessors.find({type: "HTTPRequest"}).fetch());
						keys = FeedProcessors.find({type: "HTTPRequest"}).fetch();
						options = keys.map(function(val, index, arr){
							return {label: val.name, value: val.name};
						})
						return (options);
					}
				},
	},	
	responseProcessors: {
		type: [String],
		
	},
	'responseProcessors.$': {
		autoform: {
			type: "selectize",
			options: function(){
				console.log("asdf", FeedProcessors.find({type: "HTTPResponse"}).fetch());
				keys = FeedProcessors.find({type: "HTTPResponse"}).fetch();
				options = keys.map(function(val, index, arr){
					return {label: val.name, value: val.name};
				})
				return (options);
			}
		},
	},

	// action: {
	// 	type: String,
	// 	allowedValues:[ "Update"],
	// 	defaultValue: "Update"
	// },
	// doJournal: {
	// 	type: Boolean,
	// 	defaultValue: false,
	// 	label: "Keep Journal"
	// },
	// journal_limit: {
	// 	type: Number,
	// 	optional: true,
	// 	defaultValue: 50
	// },
	// journal: {
	// 	type: [Object],
	// 	optional: true,
	// 	autoform: {
	// 		omit: true
	// 	}
	// },
	// doMaxMinAvg: {
	// 	type: Boolean,
	// 	defaultValue: false,
	// 	label: 'Do Calculations'
	// },
	// maxMinAvgLimit: {
	// 	type: Number,
	// 	optional: true,
	// 	defaultValue: 50
	// },
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

});


HTTPFeeds.before.insert(function(userId, doc) {
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



HTTPFeeds.after.insert(function(userId, doc) {
				console.log("Feed insert after", userId, doc, Meteor.isClient)
	if(Meteor.isClient){
		// if(doc.pubsub != "Publish") {
		// 	console.log("Feed insert subscription", userId, doc)
		// 	topic = mqttregex(doc.subscription).topic;
		// 	topic = topic.substring(0, topic.length - 1);
		// 	 mqttClientSubscribe(topic);
		// }
	}
});

HTTPFeeds.after.update(function(userId, doc) {
	if(Meteor.isClient){
		console.log("Feed update", userId, doc)
		// if(doc.pubsub != "Publish") {
		// 	topic = mqttregex(doc.subscription).topic;
		// 	topic = topic.substring(0, topic.length - 1);
		// 	 mqttClientSubscribe(topic);
		// }
	}
});

HTTPFeeds.after.remove(function(userId, doc) {
	if(Meteor.isClient){
		console.log("Feed remove", userId, doc)
		// if(doc.pubsub != "Publish") {
		// 	topic = mqttregex(doc.subscription).topic;
		// 	topic = topic.substring(0, topic.length - 1);
		// 	 mqttClientUnsubscribe(topic);
		// }	
	}
});

HTTPFeeds.attachSchema(Schemas.HTTPFeed);

HTTPFeeds.allow({
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