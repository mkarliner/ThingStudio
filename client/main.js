
// AutoForm.debug();

Template.registerHelper("indexedArray",
	function(arr) {
  	  	return _.map(arr, function(value, index){
    	  return {value: value, index: index};
  });
});

Template.registerHelper("deviceOrientation", function(){
	console.log("DEVO ", Session.get("deviceOrientation"))
	return Session.get("deviceOrientation");
})

// devOrientHandler = function(ev) {
// 	Session.set("deviceOrientation", ev);
// }
//
// if (window.DeviceOrientationEvent) {
//  console.log("DeviceOrientation is supported");
//   window.addEventListener('deviceorientation', devOrientHandler, false);
// }

Meteor.startup(function() {
	
	// window.onerror = function (errorMsg, url, lineNumber, column, errorObj) {
	// 	    alert('Error: ' + errorMsg + ' Script: ' + url + ' Line: ' + lineNumber
	// 	    + ' Column: ' + column + ' StackTrace: ' +  errorObj);
	// 		Session.set("runtimeErrors", errorMsg);
	// 	} 
	Tracker.autorun(function(){
		ca = Session.get("currentApp");
		if(!ca){
			return[];
		}
		appTree = [ca.title];
		while(ca.parent) {
			ca = Apps.findOne({_id: ca.parent});
			//Apps may not be ready yet.
			if(!ca){
				break;
			}
			appTree.push(ca.title);
		}
		appTree.reverse();
		Session.set("appTitles", appTree);
	});

	Template.registerHelper("appTitles", function(){
		console.log("ATT", Session.get("appTitles"));
		return Session.get("appTitles");
	})

	
	// Meteor.call("foreignConnections", function(err, result){
	// 	Session.set("foreignConnections", result)
	// 	// console.log("FC: ", err, result);
	//
	// });
	Tracker.autorun(function () {	
		console.log("Running subscribe", Session.get("currentAppId"))
		Meteor.subscribe("apps", Session.get("currentAppId"), {
			onReady: function() {
				console.log("Apps Ready", Apps.find({}).fetch());
				//Is there only one App available?
				numApps = Apps.find().count();
				if(numApps == 1) {
					initialApp = Apps.findOne();
					Session.setPersistent("currentApp", initialApp);
					return;
				}
				// Are we returning to an existing App?
				initialApp = Session.get("currentApp");	
				if(initialApp) {
					Session.setPersistent("currentApp", initialApp);
					return;
				} 
				//Are we logged in, but have no Apps?
				if(Meteor.userId() && numApps == 0) {
					//If so, create first app.
					console.log("Creating default app on ready", Meteor.userId())
					appId = Apps.insert({
						title: "defaultApp",
						access: "Private",
					});
					Session.setPersistent("currentApp", Apps.findOne({_id: appId}));
					return;
				}
				//Are we logged in, with Apps, but none current?
				if(Meteor.userId) {
					initialApp = Apps.findOne({title: "defaultApp"});
					Session.setPersistent("currentApp", initialApp);
					return;
				}
				

			}
		});
	});
		
	

	
	Tracker.autorun(function () {
	  ca  = Session.get("currentApp");
	  Session.get("currentAppId");
	  if(ca) {
		  console.log("SUB: ", ca.title);
		  Meteor.subscribe("connections",ca._id, {
			onReady: function(){
				connections = Connections.find().fetch();
				// console.log(" CONNECTIONS FOUND: ", connections);
				//If the app specifies a connection, use that
				//if not, use any, or none.
				if(ca.connection) {
					conn = Connections.findOne({_id: ca.connection});
				} else {
					conn = Connections.findOne({});
				}
				// console.log("Autoconnect: ", conn);
				console.log("Connect: ", conn)
				if (conn) {
					connect(conn);
				} else {
					disconnect();
				}
			}
		});
		  Meteor.subscribe("feeds", ca._id, {
			  onReady: function(){
				  console.log("SUBSCRIBING FEEDS");
			  }
		  });
		  console.log("SUBSCRIBING SCREENS");
		  Meteor.subscribe("screens", ca._id, {
		  	  onReady: function(){
				  InstantiateScreens();
		  	  }
		  });
		  Meteor.subscribe("themes", ca._id);
	}

	})
	

		Meteor.subscribe("help_pages", {
			onReady: function() {

			},
			onError: function(error) {
				console.log("HelpPages error", error);
			}
		});

		Meteor.subscribe("userData", {
			onReady: function() {},
		});

		Meteor.subscribe("userStatus");
		
		Meteor.subscribe("userList");

	});

		AccountsTemplates.addField({
			_id: "mailing_opt_out",
			type: "checkbox",
			displayName: "Do not subscribe me to the mailing list",
		});

		// Accounts.onCreateUser(function(options, user) {
		//     //pass the surname in the options
		//
		//     user.profile['opt_in'] = options.opt_in;
		//
		//     return user;
		// }
