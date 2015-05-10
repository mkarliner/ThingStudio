TunguskaGaugeThemePack = {};




Meteor.startup(function() {
	
	// window.onerror = function (errorMsg, url, lineNumber, column, errorObj) {
	// 	    alert('Error: ' + errorMsg + ' Script: ' + url + ' Line: ' + lineNumber
	// 	    + ' Column: ' + column + ' StackTrace: ' +  errorObj);
	// 		Session.set("runtimeErrors", errorMsg);
	// 	} 
	

	
	Meteor.call("foreignConnections", function(err, result){
		Session.set("foreignConnections", result)
		// console.log("FC: ", err, result);
		
	});
	
	Meteor.subscribe("apps",  {
		onReady: function() {
			initialApp = Apps.findOne({title: "defaultApp"});
			Session.set("currentApp", initialApp);
		}
	});
	
	Tracker.autorun(function () {
	  ca  = Session.get("currentApp");
	  if(ca) {
		  console.log("SUB: ", ca.title);
		  Meteor.subscribe("connections",ca._id, {
			onReady: function(){
				conn = Connections.findOne({
					autoConnect: true
				});
				// console.log("Autoconnect: ", conn);
				if (conn) {
					connect(conn);
				}
			}
		});
		  Meteor.subscribe("feeds", ca._id);
		  Meteor.subscribe("screens", ca._id);
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
