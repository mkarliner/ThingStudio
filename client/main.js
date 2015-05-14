TunguskaGaugeThemePack = {};




Meteor.startup(function() {
	
	// window.onerror = function (errorMsg, url, lineNumber, column, errorObj) {
	// 	    alert('Error: ' + errorMsg + ' Script: ' + url + ' Line: ' + lineNumber
	// 	    + ' Column: ' + column + ' StackTrace: ' +  errorObj);
	// 		Session.set("runtimeErrors", errorMsg);
	// 	} 
	

	
	// Meteor.call("foreignConnections", function(err, result){
	// 	Session.set("foreignConnections", result)
	// 	// console.log("FC: ", err, result);
	//
	// });
	
	Meteor.subscribe("apps",  {
		onReady: function() {
			// console.log("APPS READY")
			initialApp = Apps.findOne({title: "defaultApp"});
			if(initialApp) {
				Session.set("currentApp", initialApp);
			} else if(Meteor.userId()) {
				console.log("Creating default app on ready", Meteor.userId())
				appId = Apps.insert({
					title: "defaultApp",
					access: "Private",
				});
				Session.set("currentApp", Apps.findOne({_id: appId}));
			}

		}
	});
	
	Tracker.autorun(function () {
	  ca  = Session.get("currentApp");
	  if(ca) {
		  console.log("SUB: ", ca.title);
		  Meteor.subscribe("connections",ca._id, {
			onReady: function(){
				connections = Connections.find().fetch();
				console.log("CONNECTIONS FOUND: ", connections);
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
