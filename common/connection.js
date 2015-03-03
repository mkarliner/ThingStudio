Connexions = new Mongo.Collection("connexions");



Schemas = {};

Schemas.Connexion = new SimpleSchema({
	title: {
		type: String,
		label: "Name",
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
		allowedValues:["MQTT", "Websocket"],
		defaultValue: "Websocket"
	},
	username: {
		type: String,
		optional: true
	},
	password: {
		type: String,
		optional: true
	},
	autoConnect: {
		type: Boolean,
		defaultValue: true
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
				return {$setOnInsert: Meteor.userId()};
			} else {
				this.unset();
			}
		}
	},
	// public: {
	// 	type: Boolean,
	// 	defaultValue: false
	// }
	
	
	
});

Connexions.attachSchema(Schemas.Connexion);

Connexions.allow({
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