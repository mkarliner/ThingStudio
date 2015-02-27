Connexions = new Mongo.Collection("connexions");



Schemas = {};

Schemas.Connexion = new SimpleSchema({
	title: {
		type: String,
		label: "Name",
		max: 200
	},
	host: {
		type: String,
		label: "Hostname"
	},
	port: {
		type: Number,
		label: "Port",
		// defaultValue: 3000
	},
	protocol: {
		type: String,
		allowedValues:["MQTT", "Websocket"],
		defaultValue: "Websocket"
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
				return {$setOnInsert: Meteor.userId};
			} else {
				this.unset();
			}
		}
	},
	public: {
		type: Boolean,
		defaultValue: false
	}
	
	
	
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