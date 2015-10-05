///////////////////////////////////////////////////////////////////////////////////////
// General Purpose Functions //
///////////////////////////////////////////////////////////////////////////////////////

arrayOfObjectsFromObject = function (obj) {
// To make #each available with an object that is not an array
	result = [];
	for (var key in obj){
			result.push({name:key,value:obj[key]});
	}
	return result;
}

// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/keys
if (!Object.keys) {
  Object.keys = (function() {
    'use strict';
    var hasOwnProperty = Object.prototype.hasOwnProperty,
        hasDontEnumBug = !({ toString: null }).propertyIsEnumerable('toString'),
        dontEnums = [
          'toString',
          'toLocaleString',
          'valueOf',
          'hasOwnProperty',
          'isPrototypeOf',
          'propertyIsEnumerable',
          'constructor'
        ],
        dontEnumsLength = dontEnums.length;

    return function(obj) {
      if (typeof obj !== 'object' && (typeof obj !== 'function' || obj === null)) {
        throw new TypeError('Object.keys called on non-object');
      }

      var result = [], prop, i;

      for (prop in obj) {
        if (hasOwnProperty.call(obj, prop)) {
          result.push(prop);
        }
      }

      if (hasDontEnumBug) {
        for (i = 0; i < dontEnumsLength; i++) {
          if (hasOwnProperty.call(obj, dontEnums[i])) {
            result.push(dontEnums[i]);
          }
        }
      }
      return result;
    };
  }());
}

///////////////////////////////////////////////////////////////////////////////////////
// HTTP  Management//
///////////////////////////////////////////////////////////////////////////////////////


FeedProcessors = new Mongo.Collection(null);

FeedList = new Mongo.Collection(null);

Meteor.startup(function(){
	Tracker.autorun(function(){
		mqttFeeds = Feeds.find().fetch();
		for(var m=0; m<mqttFeeds.length; m++) {
			FeedList.insert({name: mqttFeeds[m].title, type: "MQTT"})
		}
		httpFeeds = HTTPFeeds.find().fetch();
		for(var h=0; h<httpFeeds.length; h++) {
			FeedList.insert({name: httpFeeds[h].title, type: "HTTP"})
		}
	});
})



RegisterFeedProcessor = function(name,  type, func) {
	// Type can be HTTPRequest, HTTPResponse
	// HTTPFeedProcessors[name] = func;
	FeedProcessors.insert({name: name, func: func, type: type})
}


var HTTPClock = 0;

RegisterFeedProcessor("testReq", "HTTPRequest", function(app, conn, feed, message){
	console.log("testReq Proc", feed, message);
	return ({
		content: message
	})
});

RegisterFeedProcessor("StdJSON", "HTTPResponse", function(app, conn, feed, error, result){
	console.log("RESPONSE: ", feed, error, result);
	if(error) {
		console.log("HRRPR: ", error.message );
		return;
	}
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

function interval(func, wait, times){
    var interv = function(w, t){
        return function(){
            if(typeof t === "undefined" || t-- > 0){
                setTimeout(interv, w);
                try{
                    func.call(null);
                }
                catch(e){
                    t = 0;
                    throw e.toString();
                }
            }
        };
    }(wait, times);

    setTimeout(interv, wait);
};


checkHTTPFeeds = function (){
	//console.log("HTTP clock");
	HTTPClock++;
	var feeds = HTTPFeeds.find().fetch();

	//Check which feeds need to be polled.
	for(var f=0; f<feeds.length; f++) {
		if(HTTPClock % feeds[f].polling_interval == 0 ) {
			var feed = feeds[f];
			var conn = HTTPConnections.findOne(feed.connection);
			var app = Apps.findOne({_id: conn.appId});
			var url = conn.protocol + "://" + conn.host + ":" + conn.port + feed.path;
			timeout = (feed.polling_interval-1)*1000;
			console.log("HT: ", feed.responseProcessor, feed.requestProcessor, conn, url, timeout);
			var reqProc = FeedProcessors.findOne({type: "HTTPRequest", name: feed.requestProcessor});
			var options = reqProc.func(app, conn, feed, "Null Message");
			console.log("BEFORE HTTP Poll:", feed.verb, url, options);
			HTTP.call(feed.verb, url, options, function(error, result) {
				//console.log("HRET: ", error, result);
				//Call each feed processor in turn
				// for(var p=0; p<feed.processors.length; p++ ){
				// 	//console.log("CALLING: ", HTTPFeedProcessors[feed.processors[p]])
				// 	HTTPFeedProcessors[feed.processors[p]](feed, error, result);
				// }
				var fp = FeedProcessors.findOne({type: "HTTPResponse", name: feed.responseProcessor});
				//console.log("FP: ", fp, FeedProcessors.find().fetch());
<<<<<<< HEAD
				fp.func(app, conn, feed, error, result);
				
=======
				fp.func(feed, error, result);

>>>>>>> X-model-ui
			})
		}
	}
	// console.log("HTTP Clock", HTTPClock)
}


// var HTTPClock = 0;
// Meteor.startup(function(){
// 	Meteor.setTimeout(checkHTTPFeeds, 1000);
// 	Session.set("FeedProcessors", Object.keys(HTTPFeedProcessors));
// });
Meteor.startup(function() {
	console.log("Starting HTTP Check");
	interval(checkHTTPFeeds, 1000);
})



///////////////////////////////////////////////////////////////////////////////////////
// MQTT & Connection Management//
///////////////////////////////////////////////////////////////////////////////////////

mqttClient = {};

Messages = new Mongo.Collection(null);
OldMessages = new Mongo.Collection(null);

Outbox = new Mongo.Collection(null);

SubscribedTopics = new Array();

Feedhooks = {};




publish = function(feedName, message) {
	if(typeof(feedName) != "string") {
		console.log("NON-FEED NAME PASSED TO PUBLISH", feedName, typeof feedName);
		return;
	}
	feedType = FeedList.findOne({name: feedName}).type;
	if(!feedType) {
		console.log("NO SUCH FEED: ", feedName)
	}
	switch(feedType) {
	case "MQTT":
		feed = Feeds.findOne(feedName);
		if(feed.pubsub !="Publish") {
			message = "Attempt to publish to subcription feed: "+ feed.title;
			Alerts.upsert({type: 'runtime', status: "warning", message:  message},{$set:{type: 'runtime', status: 'warning', message: message} ,$inc: {count: 1} } );
		} else {
			Outbox.upsert({topic: feed.subscription}, {$set: { feed: feed.title, topic: feed.subscription, payload: message},$inc: {count: 1}});
			mqttClient.publish(feed.subscription, message);
		}
		break;
	case "HTTP":
		var feed = HTTPFeeds.findOne({title: feedName});
		var app = getCurrentApp();
		var conn = HTTPConnections.findOne(feed.connection);
		console.log("HTTP FEED Request", feedName, feed);
		//Get the requestProcessor for this feed
		var fp = FeedProcessors.findOne({name: feed.requestProcessor});
		//And call it to process the outgoing message
		console.log("NOTE TO SELF - request feed processor need access to request!!!!!!!");
		var options = fp.func(app, conn, feed, message);
		//Record that we have done this for debugging.
		Outbox.upsert({topic: feed.path}, {$set: { feed: feed.title, topic: feed.path, payload: message},$inc: {count: 1}});
		//Now actually do the deed.

		var url = conn.protocol + "://" + conn.host + ":" + conn.port +feed.path;
		timeout = 5*1000;
				options.headers = {};
				options.timeout = timeout;
				//options.headers["Access-Control-Allow-Headers"] = "Access-Control-Allow-Origin, Origin, X-Requested-With, Content-Type, Accept";
				//options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
		//options.headers['Access-Control-Allow-Origin'] = '*';
		//options.headers["Access-Control-Allow-Headers"] = "Access-Control-Allow-Origin, Origin, X-Requested-With, Content-Type, Accept";
		//options.headers['Content-Type'] = "application/json";
		console.log("HTTPCALL: ", feed.verb, url, options )
		HTTP.call(feed.verb, url, options, function(error, result) {
			console.log("HEV: ", error, result)
			var rp = FeedProcessors.findOne({type: "HTTPResponse", name: feed.responseProcessor});
			//console.log("FP: ", fp, FeedProcessors.find().fetch());
<<<<<<< HEAD
			rp.func(app, conn, feed, error, result);		
=======
			rp.func(feed, error, result);
>>>>>>> X-model-ui
		})
		break;
	default:
		console.log("UNKNOWN FEED TYPE: ", feedType)
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

getAppTree = function(appId){
	//console.log("GAT ", appId)
	baseAppId = Meteor.settings.public.systemApp;
	app = Apps.findOne({_id: appId});
	if(!app) {
		return false;
	}
	apps = [app._id];

	if(baseAppId) {
		console.log("Set system app to ", baseAppId)
		apps = [app._id, baseAppId];
	} else {
		console.log("NO SYSTEM APP DEFINED!!!!");
		apps = [app._id];
	}

	while(app.ancestor) {
		app = Apps.findOne({_id: app.ancestor})
		apps.push(app._id);
	}
	return apps;
}

InitialiseApps = function(){
	FeedProcessors.remove();
	FeedList.remove();
	//First initialise the system App js.

	capp = getCurrentApp();
	if(!capp) {
		return;
	}
	applist = getAppTree(capp._id);

	console.log("Initialising Apps", applist);
	for(var a=0; a<applist.length; a++ ){
		var app = Apps.findOne(applist[a]);
		if(app && app.js) {
			console.log("Initialising app ", app.title);
			eval(app.js);
		}
	}
}


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
