Connections = new Mongo.Collection("connections");

// Schemas = {};

Schemas.Connection = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
		max: 200,
	},
	host: {
		type: String,
		label: "Hostname"
	},
	port: {
		type: Number,
		label: "Port",
		defaultValue: 9001
	},
	protocol: {
		type: String,
		allowedValues: ["Websocket", "SecureWebsocket"],
		defaultValue: "Websocket",
		optional: true
	},
	serverCredentials: {
		//Provide credentials from server store.
		type: Boolean,
		defaultValue: false,
		label: " ",
		autoform: {
			afFieldInput: {
				type: 'boolean-checkbox-b'
				// class: 'editor' // optional
				// summernote options goes here
			}
		},
	},
	username: {
		type: String,
		optional: true
	},
	password: {
		type: String,
		optional: true
	},
	// autoConnect: {
	// 	type: Boolean,
	// 	defaultValue: true
	// },
	owner: {
		type: String,
		index: true,
		autoform: {
			omit: true
		},
		autoValue: function() {
			if (this.isInsert) {
				return Meteor.userId();
			} else if (this.isUpsert) {
				return {
					$setOnInsert: Meteor.userId
				};
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
	// public: {
	// 	type: Boolean,
	// 	defaultValue: false
	// }



});



Connections.before.insert(function(userId, doc) {
	if (Meteor.isClient) {		
		doc.appId = Session.get("currentApp")._id;
		console.log("BEFOREHOOK ", userId, doc, Session.get("currentApp"));
		return true;
	} else {
		console.log("BEFOREHOOK Server", userId, doc);
	}
});

Connections.attachSchema(Schemas.Connection);

Connections.allow({
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
