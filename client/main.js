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


	
});

// Accounts.onCreateUser(function(options, user) {
//     //pass the surname in the options
//
//     user.profile['opt_in'] = options.opt_in;
//
//     return user;
// }
Meteor.subscribe("docs");



 AutoForm.debug();

// devOrientHandler = function(ev) {
// 	Session.set("deviceOrientation", ev);
// }
//
// if (window.DeviceOrientationEvent) {
//  console.log("DeviceOrientation is supported");
//   window.addEventListener('deviceorientation', devOrientHandler, false);
// }