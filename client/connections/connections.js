
mqttClient = {};

Messages = new Mongo.Collection(null);


Session.set("connectionStatus", false);

connect = function (conn) {
	protocol = conn.protocol == "MQTT" ? "mqtt" : "ws";
	connectionString = protocol + "://" + conn.host + ":" + conn.port;
	console.log("Connecting", connectionString);
	mqttClient = mqtt.connect(connectionString);
	mqttClient.on("connect", function(){
		Session.set("connectionStatus", true);
		feeds = Feeds.find({}).fetch();
		i =0;
		for(i=0; i<feeds.length; i++) {
			topic = mqttregex(feeds[i].subscription).topic;
			topic = topic.substring(0, topic.length - 1);
			console.log("Subscribing to ", topic);
			mqttClient.subscribe(topic);
		}
	});
	mqttClient.on("close", function(){
		console.log("close");
		Session.set("connectionStatus", false);
	});
	mqttClient.on("offline", function(){
		console.log("offline");
		Session.set("connectionStatus", false);
	});
	mqttClient.on("error", function(e){
		console.log("connection error", e)
		Session.set("connectionStatus", false);
	});
	mqttClient.on("message", function(topic, message){
		//Actually do something useful.
		console.log("Message received", topic, message);
		feeds = Feeds.find({}).fetch();
		i =0;
		for(i=0; i<feeds.length; i++) {
			console.log("Checking to ", feeds[i].subscription);
			regex = mqttregex(feeds[i].subscription).exec;
			result = regex(topic);
			if(result) {
				console.log("Feed matched", result);
				Messages.upsert({topic: topic}, {$set: {feed: feeds[i].title, topic: topic, message: message.toString()}});
			}
		}
		
	});
	
}

Meteor.startup(function(){
 
});


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
		connect(this);
		
	}
});

