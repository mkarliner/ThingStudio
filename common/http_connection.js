HTTPConnections = new Mongo.Collection("http_connections");

Schemas.HTTPConnection = new SimpleSchema({
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
		defaultValue: 80
	},
	protocol: {
		type: String,
		defaultValue: "http",
		optional: true,
		autoform: {
			type: "selectize",
			options: function(){
				options = [{label: "http", value: "http"}, {label: "https", value: "https"}];
				return (options);
			}
		}
	},
	username: {
		type: String,
		optional: true
	},
	password: {
		type: String,
		optional: true
	},
	// serverCredentials: {
	// 	//Provide credentials from server store.
	// 	type: Boolean,
	// 	defaultValue: false,
	// 	label: "Use Server Credentials",
	// 	autoform: {
	// 		afFieldInput: {
	// 			type: 'boolean-checkbox-M',
	// 			class: 'filled-in' // optional
	// 			// summernote options goes here
	// 		}
	// 	}
	// },
	// username: {
	// 	type: String,
	// 	optional: true
	// },
	// password: {
	// 	type: String,
	// 	optional: true,
	// 	autoform: {
	// 		afFieldInput: {
	// 			type: 'password'
	// 			// class: 'filled-in' // optional
	// 			// summernote options goes here
	// 		}
	// 	}
	// },
	// autoHTTPConnect: {
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



HTTPConnections.before.insert(function(userId, doc) {
	if (Meteor.isClient) {		
		doc.appId = Session.get("currentApp")._id;
		console.log("BEFOREHOOK ", userId, doc, Session.get("currentApp"));
		return true;
	} else {
		app = Apps.findOne(doc.appId);
		if(app.owner != doc.owner) {
			console.log("Attempt to create http_connection in someone else's app.")
			return false;
		} 
		//console.log("BEFOREHOOK Server", userId, doc);
	}
});

HTTPConnections.after.update(function(userId, doc) {
	console.log("DIOC ", doc)
	if(Meteor.isClient) {
		// currConn = getCurrentHTTPConnection();
		// if(currConn._id == doc._id) {
		// 	setCurrentHTTPConnection(doc);
		// }
	}
});

HTTPConnections.attachSchema(Schemas.HTTPConnection);

HTTPConnections.allow({
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
