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
		
	})

		Meteor.subscribe("connections", {
			onReady: function() {
				conn = Connections.findOne({
					autoConnect: true
				});
				// console.log("Autoconnect: ", conn);
				if (conn) {
					connect(conn);
				}


			},
			onError: function(error) {
				console.log("Connections error", error);
			}
		});

		Meteor.subscribe("screens", {
			onReady: function() {

			},
			onError: function(error) {
				console.log("Screens error", error);
			}
		});

		Meteor.subscribe("feeds", {
			onReady: function() {

			},
			onError: function(error) {
				console.log("Feeds error", error);
			}
		});

		Meteor.subscribe("themes", {
			onReady: function() {

			},
			onError: function(error) {
				console.log("Themes error", error);
			}
		});

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
