Tracker.autorun(function(){
	caId = Session.get("currentAppId");
	ca = Apps.findOne({_id: caId});
	if(!ca){
		return[];
	}
	appTree = [{_id: ca._id, title: ca.title}];
	while(ca.parent) {
		ca = Apps.findOne({_id: ca.parent});
		//Apps may not be ready yet.
		if(!ca){
			break;
		}
		appTree.push({id: ca._id, title: ca.title});
	}
	appTree.reverse();
	Session.set("appTreeList", appTree);
});

Tracker.autorun(function() {
	// Set currentApp based on currentAppId
	var id = Session.get("currentAppId");
	var app = Apps.findOne({ _id: id });
	
	if (app) {
		Session.set("currentApp", app);
	} else {
		Session.set("currentApp", { _id: null })
	}
});

Meteor.startup(function(){
	Feeds.after.insert(function(userId, doc) {
		if(doc.pubsub == "Subscription") {
			mqttClient.subscribe(doc.subscription);
		}	
	});
	Feeds.after.update(function(userId, doc) {
		if(doc.pubsub == "Subscription") {
			mqttClient.subscribe(doc.subscription);
		}
	});
	Meteor.subscribe("userData", {
		onReady: function() {},
	});
	Meteor.subscribe("userStatus");
	Meteor.subscribe("userList");
	// window.onerror = function (errorMsg, url, lineNumber, column, errorObj) {
	// 	    alert('Error: ' + errorMsg + ' Script: ' + url + ' Line: ' + lineNumber
	// 	    + ' Column: ' + column + ' StackTrace: ' +  errorObj);
	// 		Session.set("runtimeErrors", errorMsg);
	// 	} 
});

Accounts.onLogin(function(){
	// This is not associated with any route.
	//We decide what the initial app should be here.

	initialApp = Session.get("currentAppId");
	console.log("Initial App on Login ", initialApp);
	if(initialApp) {
		return;
	}
	Meteor.subscribe("apps", {
		onReady: function(){
			if (!Meteor.userId()) {
				console.log("Not logged in at startup - bailing.")
				return;
			}
			console.log("Apps Ready", Apps.find({}).fetch());
			//Is there only one App available?
			numApps = Apps.find().count();
			if(numApps == 1) {
				initialApp = Apps.findOne();
				Session.setPersistent("currentAppId", initialApp._id);
				return;
			}
			//Are we logged in, but have no Apps?
			if(Meteor.userId() && numApps == 0) {
				//If so, create first app.
				//console.log("Creating default app on ready", Meteor.userId())
				appId = Apps.insert({
					title: "defaultApp",
					access: "Private",
				});
				Session.setPersistent("currentAppId", appId);
				return;
			}
			//Are we logged in, with Apps, but none current?
			//Just choose the 'defaultApp
			if(Meteor.userId) {
				initialApp = Apps.findOne({title: "defaultApp"});
				Session.setPersistent("currentAppId", initialApp._id);
				return;
			}

		}
	})
})

// Accounts.onCreateUser(function(options, user) {
//     //pass the surname in the options
//
//     user.profile['opt_in'] = options.opt_in;
//
//     return user;
// }

// AutoForm.debug();

// devOrientHandler = function(ev) {
// 	Session.set("deviceOrientation", ev);
// }
//
// if (window.DeviceOrientationEvent) {
//  console.log("DeviceOrientation is supported");
//   window.addEventListener('deviceorientation', devOrientHandler, false);
// }