TunguskaGaugeThemePack = {};

Meteor.startup(function() {

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

	});

		AccountsTemplates.addField({
			_id: "mailing_list",
			type: "checkbox",
			displayName: "Subscribe me to mailing List",
		});

		// Accounts.onCreateUser(function(options, user) {
		//     //pass the surname in the options
		//
		//     user.profile['opt_in'] = options.opt_in;
		//
		//     return user;
		// }
	