
mqttClient = {};

Messages = new Mongo.Collection(null);

Outbox = new Mongo.Collection(null);

publish = function(topic, message) {
	Outbox.upsert({topic: topic}, {$set: { topic: topic, message: message}});
	mqttClient.publish(topic, message);
	
}


Session.set("ConnectionStatus", false);

connect = function (conn) {
	protocol = conn.protocol == "MQTT" ? "mqtt" : "ws";
	ConnectionString = protocol + "://" + conn.host + ":" + conn.port;
	mqttClient = mqtt.connect(ConnectionString);
	mqttClient.on("connect", function(){
		Session.set("ConnectionStatus", true);
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
	});
	mqttClient.on("offline", function(){
		console.log("offline");
		Session.set("ConnectionStatus", false);
	});
	mqttClient.on("error", function(e){
		console.log("Connection error", e)
		Session.set("ConnectionStatus", false);
	});
	mqttClient.on("message", function(topic, message){
		//Actually do something useful.
		console.log("Message received", topic, message);
		feeds = Feeds.find({}).fetch();
		i =0;
		for(i=0; i<feeds.length; i++) {
			// console.log("Checking to ", feeds[i].subscription);
			regex = mqttregex(feeds[i].subscription).exec;
			result = regex(topic);
			if(result) {
				// console.log("Feed matched", result);
				Messages.upsert({topic: topic}, {$set: {feed: feeds[i].title, topic: topic, message: message.toString()}});
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
});




Template.Connections.events({
	'click .connect': function(ev){
		console.log("Connect button", ev, this);
		connect(this);
		
	}
});

