
mqttClient = {};

Session.set("connectionStatus", false)
Template.Connexions.helpers({
	connexions: function(){
		return Connexions.find({});
	},
	connection_status: function(){
		return Session.get("connectionStatus") ? "connected" : "disconnected";
	}
});


Template.Connexions.events({
	'click .connect': function(ev){
		console.log("Connect button", ev, this);
		protocol = this.protocol == "MQTT" ? "mqtt" : "ws";
		connectionString = protocol + "://" + this.host + ":" + this.port;
		console.log("Connecting", connectionString);
		mqttClient = mqtt.connect(connectionString);
	}
});