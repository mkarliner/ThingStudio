
mqttClient = {};

Messages = new Mongo.Collection(null);

Outbox = new Mongo.Collection(null);

publish = function(topic, message) {
	Outbox.upsert({topic: topic}, {$set: { topic: topic, message: message}});
	mqttClient.publish(topic, message);
	
}


Session.set("ConnectionStatus", false);
Session.set("connectionErrors", null);

connect = function (conn) {
	if (typeof mqttClient.end == 'function') { 
		console.log("Ending current client");
	  mqttClient.end(); 
	}
	protocol = conn.protocol == "MQTT" ? "mqtt" : "ws";
	ConnectionString = protocol + "://" + conn.host + ":" + conn.port;
	console.log("Connecting: ", conn.username, conn.password);
	try {
		mqttClient = mqtt.connect(ConnectionString, {username: conn.username, password: conn.password});
		// console.log("MQQC:", mqttClient)
	}
	catch(err) {
		console.log(err)
		Session.set("connectionErrors", err);
	}
	mqttClient.on("connect", function(){
		Session.set("ConnectionStatus", true);
		Session.set("connectionErrors", null);
		feeds = Feeds.find({}).fetch();
		i =0;
		for(i=0; i<feeds.length; i++) {
			topic = mqttregex(feeds[i].subscription).topic;
			topic = topic.substring(0, topic.length - 1);
			mqttClient.subscribe(topic);
		}
	});
	mqttClient.on("close", function(){
		console.log("close");
		Session.set("ConnectionStatus", false);
		Session.set("connectionErrors", "Closed")
	});
	mqttClient.on("offline", function(){
		console.log("offline");
		Session.set("ConnectionStatus", false);
		Session.set("connectionErrors", "Offline");
	});
	mqttClient.on("error", function(e){
		console.log("Connection error", e)
		Session.set("ConnectionStatus", false);
		Session.set("connectionErrors", e);
	});
	mqttClient.on("message", function(topic, rawmessage){
		//Actually do something useful.
		//console.log("Message received", topic, rawmessage);
		//Convert message to JSON
		try {
			payload = JSON.parse(rawmessage);
			// console.log("Payload rx: ", payload);
		}
		catch(err) {
			console.log("MERR: ", err);
			Session.set("runtimeErrors", "Invalid MQTT message, payload not JSON: " + rawmessage.toString());
			payload = rawmessage.toString();
		}
		feeds = Feeds.find({}).fetch();
		i =0;
		for(i=0; i<feeds.length; i++) {
			// console.log("Checking to ", feeds[i].subscription);
			regex = mqttregex(feeds[i].subscription).exec;
			result = regex(topic);
			if(result) {
				// console.log("Feed matched", result);
				Messages.upsert({topic: topic, feed: feeds[i].title}, {$set: {feed: feeds[i].title, topic: topic, payload: payload}});
			}
		}
		
	});
	
}

Meteor.startup(function(){
 
});


Template.Connections.helpers({
	connections: function(){
		return Connections.find({});
	},
	// Connection_status: function(){
	// 	return Session.get("ConnectionStatus") ? "connected" : "disconnected";
	// }
	foreignConnections: function(){
		fc = Session.get("foreignConnections");
		console.log("TC: ", fc);
		return fc;
	},
	username: function(id) {
		return Meteor.users.findOne(id).username;
	}
});




Template.Connections.events({
	'click .connect': function(ev){
		console.log("Connect button", ev, this);
		connect(this);
		
	}
});

