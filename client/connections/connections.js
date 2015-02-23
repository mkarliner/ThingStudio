
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
			console.log("Subscribing to ", feeds[i].subscription);
			mqttClient.subscribe(feeds[i].subscription);
		}
	});
	mqttClient.on("close", function(){
		Session.set("connectionStatus", false);
	});
	mqttClient.on("offline", function(){
		Session.set("connectionStatus", false);
	});
	mqttClient.on("error", function(){
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
				console.log("Feed matched");
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

