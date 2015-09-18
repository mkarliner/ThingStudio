///////////////////////////////////////////////////////////////////////////////////////
// HTTP  Management//
///////////////////////////////////////////////////////////////////////////////////////


HTTPFeedProcessors = {

}


RegisterHTTPFeedProcessor = function(name, func) {
	HTTPFeedProcessors[name] = func;
}



RegisterHTTPFeedProcessor("test", function(feed, error, result){
	console.log("Test Feed Processor", feed, error, result)
	try {
		payload = JSON.parse(result.content);
	}
	catch(err) {
		console.log("HERR: ", err);
		Session.set("runtimeErrors", "Invalid MQTT message, payload not JSON: " + result.content.toString());
		payload = result.content.toString();
	}
	console.log("payload", payload)
	Messages.upsert(
		{
			topic: feed.path,
			feed: feed.title
		},
		{$set:
			{
				feed: feed.title,
				topic: feed.path,
				payload: payload},
				$inc:{count: 1
			}
		});
});




checkHTTPFeeds = function (){
	// console.log("INC HTTPCLOCK: ", HTTPClock);
	HTTPClock++;
	var feeds = HTTPFeeds.find().fetch();
	//Check which feeds need to be polled.
	for(var f=0; f<feeds.length; f++) {
		if(HTTPClock % feeds[f].polling_interval == 0 ) {
			var feed = feeds[f];
			var conn = HTTPConnections.findOne(feed.connection);
			var url = conn.protocol + "://" + conn.host+feed.path;
			timeout = (feed.polling_interval-1)*1000;
			console.log("HT: ", feed.title, conn, url, timeout);
			HTTP.call(feed.verb, url, {timeout: timeout }, function(error, result) {
				//console.log("HRET: ", error, result);
				//Call each feed processor in turn
				for(var p=0; p<feed.processors.length; p++ ){
					console.log("CALLING: ", HTTPFeedProcessors[feed.processors[p]])
					HTTPFeedProcessors[feed.processors[p]](feed, error, result);
				}
			})
		}
	}
	// console.log("HTTP Clock", HTTPClock)
	Meteor.setTimeout(checkHTTPFeeds, 1000);
}


var HTTPClock = 0;
Meteor.startup(function(){
	Meteor.setTimeout(checkHTTPFeeds, 1000);
	Session.set("FeedProcessors", Object.keys(HTTPFeedProcessors));
});




///////////////////////////////////////////////////////////////////////////////////////
// MQTT & Connection Management//
///////////////////////////////////////////////////////////////////////////////////////

mqttClient = {};

Messages = new Mongo.Collection(null);
OldMessages = new Mongo.Collection(null);

Outbox = new Mongo.Collection(null);

SubscribedTopics = new Array();

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

mqttClientSubscribe = function(topic) {
	// console.log("MQTTSUB : ", topic, SubscribedTopics);
	if(SubscribedTopics[topic]) {
		return;
	} else {
		SubscribedTopics[topic] = topic;
		mqttClient.subscribe(topic);
	}
}

mqttClientUnsubscribe= function(topic) {
	delete SubscribedTopics[topic];
	if(mqttClient.unsubscribe) {
		mqttClient.unsubscribe(topic);
	}

}

// The following functions are mostly used by widgets


publishFeed = function(feedName, message) {
	if(feedName == "dummyfeed") {
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

Meteor.setInterval(function(){
	if(mqttClient.connected) {
		Session.set("ConnectionStatus", true);
	} else {
		Session.set("ConnectionStatus", true);
	}

}, 5000);


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
	return isEditable(this);
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



isAdmin = function(userId) {
	user = Meteor.users.findOne({
		_id: userId
	});
	if (user && user.roles && user.roles.indexOf('admin') > -1) {
		// console.log("Admin user", user);
		return true;
	} else {
		return false;
	}
}

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
	OldMessages.remove({});
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
	if (typeof  mqttClientUnsubscribe != 'function') {
		console.log("No connection");
	    return;
	}
	feeds = Feeds.find({}).fetch();
	for(var f=0; f<feeds.length; f++) {
		topic = mqttregex(feeds[f].subscription).topic;
		topic = topic.substring(0, topic.length - 1);
		// console.log("Unsubscribing feed: ", feeds[f].title, topic);
		 mqttClientUnsubscribe(topic);
	}
}

connect = function (conn, usr, pass) {
	// console.log("ENTERING CONN", conn, usr, pass, Session.get("currentMQTTHost"));
	if(mqttClient.connected && conn._id == Session.get("currentMQTTHost")) {
		console.log("ATTEMPT to connect to current connected connection");
		return;
	}
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
	Session.set("currentMQTTHost", conn._id);
	try {
		mqttClient = mqtt.connect(ConnectionString, { username: username, password: password, _id: conn._id});
		// console.log("MQQC:", mqttClient)
	}
	catch(err) {
		console.log(err)
		Session.set("connectionErrors", err);
	}
	mqttClient.on("connect", function(){
		// console.log("CONNECTED to ", this);
		Session.set("ConnectionStatus", true);
		Session.set("connectionErrors", null);
		feeds = Feeds.find({pubsub: "Subscribe"}).fetch();
		i =0;
		for(i=0; i<feeds.length; i++) {
			topic = mqttregex(feeds[i].subscription).topic;
			topic = topic.substring(0, topic.length - 1);
			 mqttClientSubscribe(topic);
		}
	});
	mqttClient.on("close", function(par){
		//console.log("close", par, this);
		if(Session.get("currentMQTTHost") == this.options._id) {

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
			//console.log("Payload rx: ", payload);
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
				if(feeds[i].jsonKey) {
					filteredPayload = payload[feeds[i].jsonKey];
					jsonKey = feeds[i].jsonKey
				} else {
					filteredPayload = payload;
					jsonKey = "none"
				}
				// console.log("Feed matched", result);
				Messages.upsert({topic: topic, feed: feeds[i].title}, {$set: {feed: feeds[i].title, topic: topic, payload: filteredPayload}, $inc:{count: 1}});
				if(feeds[i].doJournal) {
					//Do journal stuff
					Messages.update(
					   {topic: topic, feed: feeds[i].title},
					   {
					     $push: {
					       journal: {
					         $each: [ filteredPayload ],
					         $slice: -(feeds[i].journal_limit)
					       }
					     }
					   }
					)
				}
				if(feeds[i].doMaxMinAvg){
					//Only work with numeric values.
					value = parseFloat(filteredPayload);
					if(value != NaN) {
						lastMessage = OldMessages.findOne({topic: topic, feed: feeds[i].title,  jsonKey: jsonKey });
						//console.log("MMAV: ", feeds[i].title, lastMessage)
						if(lastMessage) {
							diff = value - lastMessage.value;
							if(isNaN(diff)) {
								diff = 0.0;
							}
							// console.log("DIFF: ", feeds[i].title, diff);

							// Check min
							if( value < lastMessage.min) {
								min = value;
							} else {
								min = lastMessage.min
							}
							//Check max
							if(value > lastMessage.max ) {
								max = value;
							}else {
								max = lastMessage.max
							}
							//Reset minMax?
							//console.log("CC: ", curr.count);
							count = lastMessage.count ? lastMessage.count : 0;
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
							avg = tc * value + (1.0-tc)* (lastMessage.avg ? lastMessage.avg : value);
							diffavg = tc * diff + (1.0-tc)* (lastMessage.diffavg ? lastMessage.diffavg : diff);
							// console.log('DIFFAV: ', feeds[i].title, diffavg);
							//console.log("UPSERGSD: ", feeds[i].title,  lastMessage, " minMax", value, "diff: ", diff, min, max, avg, "diffavg", diffavg);
							OldMessages.upsert(
								{topic: topic, feed: feeds[i].title, jsonKey: jsonKey},
								{$set: {jsonKey: jsonKey, value: value, diff: diff, min: min, max: max, avg: avg, diffavg: diffavg, count: count}})
						} else {
							console.log("minMaxInit", jsonKey, lastMessage);
							OldMessages.insert({topic: topic, feed: feeds[i].title, jsonKey: jsonKey, value: lastMessage, diff: 0, min: value, max: value, avg: value, diffavg: 0, count: 0 })
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
