
Schemas = {};
Credentials = {};

Meteor.startup(function(){

	// Template.registerHelper("Schemas", Schemas);

	//Credentials = new M.Collection(null);
	Credentials = new Ground.Collection(null);
	// GroundCredentials = new Ground.Collection("Credentials", Credentials, {
	// 	 cleanupLocalData: false,
	// 	 connection: null});

	Schemas.Credentials = new SimpleSchema({
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
	  clientId: {
	      label: "Client ID",
	      type: String,
	      optional: true
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
		username: {
			type: String,
			label: "Username",
			optional: true,
			max: 50
		},
		password: {
			type: String,
			defaultValue: "password",
			optional: true,
			autoform: {
				afFieldInput: {
					type: 'password'
					// class: 'filled-in' // optional
					// summernote options goes here
				}
			}
		},
		save: {
			type: Boolean,
			defaultValue: false,
			label: "Save details locally",
		},
		connection: {
			optional: true,
			type: String,
			autoform: {
				// omit: true
			}
		}
	});

	// Credentials.after.update(function(userId, doc) {
	// 	var thisConnection = Connections.findOne({_id: doc.connection})
	// 	if ( doc.save ) {
	// 		console.log('Saving creds: ', doc.connection)
	// 		Connections.update({_id: doc.connection}, {
	// 			$set: {
	// 				title: thisConnection.title,
	// 				host: thisConnection.host,
	// 				port: thisConnection.port,
	// 				serverCredentials: doc.save,
	// 				username: doc.username,
	// 				password: doc.password
	// 			}
	// 		})
	// 	} else {
	// 		console.log('Not saving creds: ', doc.connection)
	// 		Connections.update({_id: doc.connection}, {
	// 			$set: {
	// 				title: thisConnection.title,
	// 				host: thisConnection.host,
	// 				port: thisConnection.port,
	// 				serverCredentials: doc.save,
	// 				username: null,
	// 				password: null
	// 			}
	// 		})
	// 	}
	// });

	Credentials.attachSchema(Schemas.Credentials);
	
	Credentials.allow({
		insert: function(userId, doc) {
			return true;
		},
		update: function(userId, doc) {
			return true;
		},
		remove: function(userId, doc) {
			return true;
		}
	});
	
});


