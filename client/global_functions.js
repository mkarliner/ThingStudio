///////////////////////////////////////////////////////////////////////////////////////
// MQTT & Connection Management//
///////////////////////////////////////////////////////////////////////////////////////

mqttClient = {};

Messages = new Mongo.Collection(null);

Outbox = new Mongo.Collection(null);

publish = function(topic, message) {
	Outbox.upsert({topic: topic}, {$set: { topic: topic, message: message}});
	mqttClient.publish(topic, message);	
}

Session.set("ConnectionStatus", false);
Session.set("connectionErrors", null);

ResetMessages = function() {
	console.log("RESETTING ALL MSGS");
	Messages.remove({});
	Outbox.remove({});
}

DisconnectMQTT = function() {
	console.log("SHUTTING DOWN CLIENT")
	if (typeof mqttClient.end == 'function') { 
		console.log("Ending current client");
	    mqttClient.end(); 
	}
}

UnsubscribeAll = function(){
	if (typeof mqttClient.unsubscribe != 'function') { 
		console.log("No connection");
	    return; 
	}
	feeds = Feeds.find({}).fetch();
	for(var f=0; f<feeds.length; f++) {
		topic = mqttregex(feeds[f].subscription).topic;
		topic = topic.substring(0, topic.length - 1);
		// console.log("Unsubscribing feed: ", feeds[f].title, topic);
		mqttClient.unsubscribe(topic);
	}
}

connect = function (conn) {
	disconnect();
	protocol = conn.protocol == "Websocket" ? "ws" : "wss";
	ConnectionString = protocol + "://" + conn.host + ":" + conn.port;
	//console.log("CONNECTING: ", ConnectionString, protocol, conn.username, conn.password);
	Session.set("currentMQTTHost", conn.host);
	try {
		mqttClient = mqtt.connect(ConnectionString, { username: conn.username, password: conn.password});
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
	mqttClient.on("close", function(par){
		if(Session.get("currentMQTTHost") == this.options.hostname) {
			// console.log("close", par, this);
			Session.set("ConnectionStatus", false);
			Session.set("connectionErrors", "Closed")
		} else {
			console.log("Stale MQTT client closed");
		}
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

disconnect = function(conn) {
	if (typeof mqttClient.end == 'function') { 
		console.log("Ending current client");
		mqttClient.end(); 
	}
}

// this is fake!
currentConnection = function() {
	return true;
}

///////////////////////////////////////////////////////////////////////////////////////
// App Management//
///////////////////////////////////////////////////////////////////////////////////////

changeActiveApp = function(app) {
	UnsubscribeAll();
	DisconnectMQTT();
	Session.setPersistent("currentAppId",app._id);
	ResetMessages();
};

getCurrentApp = function() { 
	app =  Apps.findOne({_id: Session.get("currentAppId")});
	console.log("GCA: ", app, Session.get("currentAppId"));
	return app;
}

redrawSideNavSelect = function() {
	$('.side-nav select').material_select('destroy');
	$('.sidenav-app-selector').remove();
	Blaze.render(Template.AppSideNavSelect, $('.side-nav div.select-parent')[0]);
}
