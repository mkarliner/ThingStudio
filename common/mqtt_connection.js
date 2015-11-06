Connections = new Mongo.Collection("connections");

SimpleSchema.messages({
  "MQTTPortError": "1883 is the standard SOCKET port. You should be connecting via a WEB SOCKET port.",
});


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
		label: "Websocket Port",
		defaultValue: 9001,
		custom: function () {
			if ( this.value == 1883 ) {
				return "MQTTPortError";
			} else {
				return 1;
			}
		}
	},
	protocol: {
		type: String,
		defaultValue: "Websocket",
		optional: true,
		autoform: {
			type: "selectize",
			options: function(){
				options = [{label: "Websocket", value: "Websocket"}, {label: "Secure Websocket", value: "SecureWebsocket"}];
				return (options);
			}
		}
	},
	serverCredentials: {
		//Provide credentials from server store.
		type: Boolean,
		defaultValue: false,
		label: "Use Server Credentials",
		autoform: {
			afFieldInput: {
				type: 'boolean-checkbox-M',
				class: 'filled-in' // optional
				// summernote options goes here
			}
		}
	},
	username: {
		type: String,
		optional: true
	},
	password: {
		type: String,
		optional: true,
		autoform: {
			afFieldInput: {
				type: 'password'
				// class: 'filled-in' // optional
				// summernote options goes here
			}
		}
	},
	makeActiveAppConnection: {
		//Provide credentials from server store.
		type: Boolean,
		optional: true,
		defaultValue: true,
		label: "Set as active app connection? (Recommended)",
		autoform: {
			afFieldInput: {
				type: 'boolean-checkbox-M',
				class: 'filled-in' // optional
				// summernote options goes here
			}
		}
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
		//console.log("BEFOREHOOK ", userId, doc, Session.get("currentApp"));
		return true;
	} else {
		app = Apps.findOne(doc.appId);
		if(app.owner != doc.owner) {
			//console.log("Attempt to create connection in someone else's app.")
			return false;
		}
		//console.log("BEFOREHOOK Server", userId, doc);
	}
});

Connections.after.insert(function(userId, doc) {
	connectionApp = Apps.findOne({_id: doc.appId});
	if( Meteor.isServer ) {
		Apps.update({_id: connectionApp._id},
		{$set:
				{
					title: connectionApp.title,
					connection: doc._id,
					owner: connectionApp.owner,
					shareable: connectionApp.shareable,
					public: connectionApp.public

				}
			})
	}
})

Connections.after.update(function(userId, doc) {
	if(Meteor.isClient) {
		currConn = getCurrentConnection();
		if(currConn._id == doc._id) {
			setCurrentConnection(doc);
		}
	}
});

Connections.attachSchema(Schemas.Connection);

Connections.allow({
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
