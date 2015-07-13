///////////////////////////////////////////////////////////////////////////////////////
// MQTT & Connection Management//
///////////////////////////////////////////////////////////////////////////////////////

mqttClient = {};

Messages = new Mongo.Collection(null);

Outbox = new Mongo.Collection(null);

Feedhooks = {};

publish = function(feed, message) {
	if(feed.pubsub !="Publish") {
		message = "Attempt to publish to subcription feed: "+ feed.title; 
		Alerts.upsert({type: 'runtime', status: "warning", message:  message},{$set:{type: 'runtime', status: 'warning', message: message} ,$inc: {count: 1} } );
	} else {
		Outbox.upsert({topic: feed.subscription}, {$set: { feed: feed.title, topic: feed.subscription, payload: message},$inc: {count: 1}});
		mqttClient.publish(feed.subscription, message);	
	}
}

// The following functions are mostly used by widgets


publishFeed = function(feedName, message) {
	if(feedNTame == "dummyfeed") {
		return;
	}
	feed = Feeds.findOne({title: feedName});
	if(feed){
		publish(feed, JSON.stringify(message));
	} else {
		message = "No such publish feed - " + feedName;
		Alerts.upsert({type: 'runtime', status: "warning", message:  message},{$set:{type: 'runtime', status: 'warning', message: message} ,$inc: {count: 1} } );
	}
	
}

getFeed = function(feed, defVal){
				defVal = typeof defVal !== 'undefined' ? defVal : "novalue";
				msg = Messages.findOne({
					feed: feed
				});
				return msg ? msg.payload : defVal;
			}

paddedNumber = function(num, size) {
    var s = "000000000" + num;
    return s.substr(s.length-size);
}

mapValue = function(x, in_min, in_max, out_min, out_max)
{
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}


// End of Widget functions
Session.set("ConnectionStatus", false);
Session.set("connectionErrors", null);


getCurrentApp = function() { 
	app =  Apps.findOne({_id: Session.get("currentAppId")});
	return app;
};

getCredentials = function(){
	return Session.get("currentCredentials");
}

setCredentials = function(cred){
	 Session.set("currentCredentials", cred);
	 Session.set("authReady", true);
}

isEditable = function(obj) {
	if(obj.owner == Meteor.userId()) {
		return true;
	} else {
		return false;
	}
}

Template.registerHelper("thisIsEditable", function(){
	return thisIsEditable(this);
})




// startConnection = function(){
// 	//Called from the onReady function of connections.
// 	app = getCurrentApp();
// 	//Is there a connection defined for this app?
// 	if(app.connection) {
// 		connection = Connections.findOne({_id: app.connection})
// 		Session.set("currentConnection", connection );
// 		connect(connection);
// 	}
//
// }

getCurrentConnection = function() {
	return  Session.get("currentConnection");
}

setCurrentConnection = function(conn, from){
	//console.log("Setting current connection to: ", from,  conn);
	Session.set("currentConnection", conn);
}




ResetMessages = function() {
	console.log("RESETTING ALL MSGS");
	Messages.remove({});
	Outbox.remove({});
}

DisconnectMQTT = function() {
	console.log("SHUTTING DOWN CLIENT")
	if (typeof mqttClient.end == 'function') { 
		// console.log("Ending current client");
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

connect = function (conn, usr, pass) {
	// console.log("ENTERING CONN", conn, usr, pass)
	disconnect();
	setCurrentConnection(conn, "Connect");
	if(usr) {
		username = usr;
	} else {
		username = conn.username;
	}
	
	if(pass) {
		password = pass;
	} else {
		password = conn.password;
	}
	protocol = conn.protocol == "Websocket" ? "ws" : "wss";
	ConnectionString = protocol + "://" + conn.host + ":" + conn.port;
	// console.log("CONNECTING: ", ConnectionString, protocol, username, password);
	Session.set("currentMQTTHost", conn.host);
	try {
		mqttClient = mqtt.connect(ConnectionString, { username: username, password: password});
		// console.log("MQQC:", mqttClient)
	}
	catch(err) {
		console.log(err)
		Session.set("connectionErrors", err);
	}
	mqttClient.on("connect", function(){
		Session.set("ConnectionStatus", true);
		Session.set("connectionErrors", null);
		feeds = Feeds.find({pubsub: "Subscribe"}).fetch();
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
	mqttClient.on("offline", function(e){
		console.log("offline", e);
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
		feeds = Feeds.find({pubsub: "Subscribe"}).fetch();
		i =0;
		for(i=0; i<feeds.length; i++) {
			// console.log("Checking to ", feeds[i].subscription);
			regex = mqttregex(feeds[i].subscription).exec;
			result = regex(topic);
			if(result) {
				// console.log("Feed matched", result);
				if(feeds[i].jsonKey) {
					payload = payload[feeds[i].jsonKey];
				}
				Messages.upsert({topic: topic, feed: feeds[i].title}, {$set: {feed: feeds[i].title, topic: topic, payload: payload}, $inc:{count: 1}});
				if(feeds[i].doJournal) {
					//Do journal stuff
					Messages.update(
					   {topic: topic, feed: feeds[i].title},
					   {
					     $push: {
					       journal: {
					         $each: [ payload.toString() ],
					         $slice: -(feeds[i].journal_limit)
					       }
					     }
					   }
					)
				}
				if(feeds[i].doMaxMinAvg){
					//Only work with numeric values.
					value = parseFloat(payload);
					if(value != NaN) {
						curr = Messages.findOne({topic: topic, feed: feeds[i].title });
						if(curr) {
							diff = value - curr.oldValue
							// Check min
							if(!curr.min || value < curr.min) {
								min = value;
							}
							//Check max
							if(!curr.max || value > curr.max ) {
								max = value;
							}
							//Reset minMax?
							//console.log("CC: ", curr.count);
							count = curr.count ? curr.count : 0;
							if( count >= feeds[i].maxMinAvgLimit) {
								count = 0;
								min = value;
								max = value;
								// console.log("RESET MM", feeds[i].maxMinAvgLimit)
							} else {
								count +=1;
							} 
							//Generate exp moving average
							tc = 0.1;
							avg = tc * value + (1.0-tc)* (curr.avg ? curr.avg : value);
							diffavg = tc * diff + (1.0-tc)* (curr.diffavg ? curr.diffavg : diff);
							//console.log("minMax", value, "diff: ", diff, min, max, avg);
							Messages.upsert({topic: topic, feed: feeds[i].title}, {$set: {oldValue: value, diff: diff, min: min, max: max, avg: avg, diffavg: diffavg, count: count}})
						} else {
							//console.log("minMaxInit", curr);
							Message.insert({topic: topic, feed: feeds[i].title, oldValue: curr, diff: 0, min: 0, max: 0, avg: value, diffavg: diff, count: 0 })
						}
					}
				}
				if(Feedhooks[feeds[i].title]) {
					Feedhooks[feeds[i].title](payload);	
				}
			}

			
		}
	});
}

disconnect = function(conn) {
	if (typeof mqttClient.end == 'function') { 
		// console.log("Ending current client");
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

changeActiveApp = function(appId) {
	UnsubscribeAll();
	DisconnectMQTT();
	Session.setPersistent("currentAppId",appId);
	ResetMessages();
};

getCurrentApp = function() { 
	app =  Apps.findOne({_id: Session.get("currentAppId")});
	return app;
}

///////////////////////////////////////////////////////////////////////////////////////
// Alert Management//
///////////////////////////////////////////////////////////////////////////////////////
