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
		defaultValue: 1883
	},
	protocol: {
		type: String,
		allowedValues:["MQTT", "Websocket"]
	}
	
	
});

Connexions.attachSchema(Schemas.Connexion);

// Connexions.allow({
// 	insert: function() {
// 		return true;
// 	}
// })