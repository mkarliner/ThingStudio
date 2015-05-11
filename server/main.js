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

Meteor.startup(function() {
	//Before anything, initialise defaultApp for all users 
	//and connect any orphan resources.
	no_connection_cnt = 0;
	no_app_cnt = 0;
	app_cnt = 0;
	app = {};
	orphan_connections_before = Connections.find({appId: {$exists: false}}).fetch().length;
	orphan_feeds_before = Feeds.find({appId: {$exists: false}}).fetch().length;
	orphan_screens_before = Screens.find({appId: {$exists: false}}).fetch().length;
	orphan_themes_before = Themes.find({appId: {$exists: false}}).fetch().length;
	console.log("Start of App Check");
	users = Meteor.users.find({}).fetch();
	console.log("USERS:", users.length)
	for(var i=0; i<users.length; i++) {
		u = users[i];
		//console.log("Checking user:\t", u.username);
		app = Apps.findOne({owner: u._id });
		if(app) {
			//console.log("Found app ok");
			app_cnt++;
		} else {
			console.log("No apps, creating default", u._id);
			no_app_cnt++;
			app = {};
			app._id  = Apps.insert({
				title: "defaultApp",
				owner: u._id,
				access: "Private"
			},{getAutoValues: false});
		}
		//Hook any orphan connections to app.
		conns = Connections.find({owner: u._id}).fetch();
		//console.log("Connections", conns.length);
		if(conns.length == 0) {
			//console.log("Creating default connection for user: ", u.username);
			no_connection_cnt++;
			Connections.insert({
				title: "Modern Industry",
				host: "mqtt.thingstud.io",
				port: 9001,
				protocol: "Websocket",
				owner: u._id,
				appId: app._id,
				username: "guest",
				password: "guest",
				autoConnect: true
			});
			conns = Connections.find({owner: u._id}).fetch();
		}
		for(var c=0; c< conns.length; c++){
			connection = conns[c];
			if(connection.appId) {
				//console.log("Connection AppId OK"); 
			} else {
				//console.log("Hooking connection: ", connection._id, " to app ", app._id);
				Connections.update({_id: connection._id}, {$set: {appId: app._id}});
			}
		}
		feeds = Feeds.find({owner: u._id}).fetch();
		for(var f=0; f<feeds.length; f++) {
			feed = feeds[f];
			if(!feed.appId) {
				Feeds.update({_id: feed._id}, {$set: {appId: app._id}});
			}
		}
		screens = Screens.find({owner: u._id}).fetch();
		for(var s=0; s<screens.length; s++) {
			scr = screens[s];
			if(!scr.appId) {
				Screens.update({_id: scr._id}, {$set: {appId: app._id}});
			}
		}
		themes = Themes.find({owner: u._id}).fetch();
		for(var t=0; t<themes.length; t++) {
			theme = themes[t];
			if(!theme.appId) {
				Themes.update({_id: theme._id}, {$set: {appId: app._id}});
			}
		}
	}
	
	orphan_connections_after = Connections.find({appId: {$exists: false}}).fetch().length;
	orphan_feeds_after = Feeds.find({appId: {$exists: false}}).fetch().length;
	orphan_screens_after = Screens.find({appId: {$exists: false}}).fetch().length;
	orphan_themes_after = Themes.find({appId: {$exists: false}}).fetch().length;
	console.log("Before: connections: ", orphan_connections_before,"feeds: ", orphan_feeds_before, "screens: ", orphan_screens_before, "themes:", orphan_themes_before);
	console.log("After connections: ", orphan_connections_after,"feeds: ", orphan_feeds_after,"screens: ", orphan_screens_after,"themes: ", orphan_themes_after);
	console.log("Users: ", users.length);
	console.log("No connection count: ", no_connection_cnt);
	console.log("No app count: ", no_app_cnt);
	console.log("App count: ", app_cnt);

	Meteor.publish("apps", function() {
		return Apps.find({owner: this.userId});
	});

	Meteor.publish("connections", function(appId) {
		app = Apps.findOne({_id: appId});
		// console.log("Subscribing connections: ", appId,  app.access)
		if(this.userId == app.owner || app.access == "Shareable") {
			// console.log("Returning connections: ", Connections.find({appId: appId}).fetch().length )
			return Connections.find({appId: appId});
		}
	});

	Meteor.publish("screens", function(appId) {
		app = Apps.findOne({_id: appId});
		// console.log("Subscribing screens: ", appId,  app.access)
		if(this.userId == app.owner || app.access == "Shareable") {
			// console.log("Returning screends: ", Screens.find({appId: appId}).fetch().length )
			return Screens.find({appId: appId});
		}
		// if (isAdmin(this.userId)) {
		// 	return Screens.find({});
		// } else {
		// 	return Screens.find({
		// 		$or: [{
		// 			owner: this.userId
		// 		}, {
		// 			public: true
		// 		}]
		// 	});
		// }

	});
	Meteor.publish("feeds", function(appId) {
		app = Apps.findOne({_id: appId});
		// console.log("Subscribing feeds: ", appId,  app.access)
		if(this.userId == app.owner || app.access == "Shareable") {
			// console.log("Returning feeds: ", Feeds.find({appId: appId}).fetch().length )
			return Feeds.find({appId: appId});
		}
		// return Feeds.find({
		// 	$or: [{
		// 		owner: this.userId
		// 	}, {
		// 		public: true
		// 	}]
		// });
	});
	Meteor.publish("themes", function(appId) {
		app = Apps.findOne({_id: appId});
		// console.log("Subscribing themes: ", appId,  app.access)
		if(this.userId == app.owner || app.access == "Shareable") {
			// console.log("Returning themes: ", Themes.find({appId: appId}).fetch().length )
			return Themes.find({appId: appId});
		}
	});
	// Meteor.publish("themes", function() {
	// 	return Themes.find({
	// 		$or: [{
	// 			owner: this.userId
	// 		}, {
	// 			public: true
	// 		}]
	// 	});
	// });
	Meteor.publish("help_pages", function() {
		return HelpPages.find({}, {
			sort: {
				pagenumber: 1
			}
		});
	});
	Meteor.publish("userData", function() {
		user = Meteor.users.find({
			_id: this.userId
		});
		if (user.roles && user.roles['admin']) {
			return Meteor.users.find({});
		} else {
			this.ready();
		}
	});

	Meteor.publish("userStatus", function() {
		user = Meteor.users.findOne({
			_id: this.userId
		});
		if (user && user.roles && user.roles.indexOf('admin') > -1) {
			return Meteor.users.find({
				"status.online": true
			}, {
				fields: {
					status: 1,
					username: 1
				}
			});
		} else {
			this.ready();
		}

	});

	Meteor.publish("userList", function() {
		user = Meteor.users.findOne({
			_id: this.userId
		});
		//console.log("ADM : ", user);
		if (user && user.roles && user.roles.indexOf('admin') > -1) {
			//console.log("ALLUSERS");
			return Meteor.users.find({}, {
				fields: {
					status: 1,
					username: 1
				}
			});
		} else {
			//console.log("ONEUSER") 
			this.ready();
		}
	})

	Meteor.publish("adminStatus", function() {
		return Meteor.users.find({
			roles: "admin",
			"status.online": true
		}, {
			fields: {
				status: 1,
				username: 1
			}
		})
	});




});
