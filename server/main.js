
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
				shareable: false,
				public: false
			},{getAutoValues: false});
		}
		//Hook any orphan connections to app.
		conns = Connections.find({owner: u._id}).fetch();

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
		if(u) {
			themes = Themes.find({owner: u._id}).fetch();
			for(var t=0; t<themes.length; t++) {
				theme = themes[t];
				if(!theme.appId) {
					Themes.update({_id: theme._id}, {$set: {appId: app._id}});
				}
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

	Meteor.publish("apps", function(appId) {
		console.log("AppSub ", appId)
		if(appId) {
			appcurr =  Apps.find({_id: appId});
			app = appcurr.fetch()[0]; 
			if(!app) {
				console.log("No such app: ", appId);
				this.ready();
				return;
			}
			if(app.shareable || isAdmin(this.userId)) {
				// console.log("Returning app", appcurr.fetch())
				return appcurr;
			} else {
				console.log("Attempt to access private app", app)
				return [];
			}
		} else {
			apps = Apps.find({owner: this.userId});
			console.log("Publish for ", this.userId)
			return apps;
			
		}
	});

	Meteor.publish("connections", function(appId) {
		console.log("Subscribing connections: ", appId)
		apps = getAppTree(appId);
		if(!apps) {
			console.log("No such app conn ", appId)
			this.ready(); //If there is not such app.
			return;
		}
		if(this.userId == app.owner || app.shareable || isAdmin(this.userId)) {
			// console.log("Returning connections: ", apps )
			return Connections.find({appId: {$in: apps}});
		} else {
			return [];
		}
	});

	Meteor.publish("screens", function(appId) {
		app = Apps.findOne({_id: appId});
		apps = getAppTree(appId);
		if(!apps) {
			console.log("No such app scr ", appId)
			this.ready(); //If there is not such app.
			return;
		}
		console.log("Subscribing screens: ", appId,  app.title, app.access)
		if(this.userId == app.owner || app.shareable || isAdmin(this.userId)) {
			// console.log("Returning screends: ", Screens.find({appId: appId}).fetch().length )
			return Screens.find({appId: {$in: apps}});
		} else {
			return [];
		}
	});
	
	Meteor.publish("widgets", function(appId) {
		app = Apps.findOne({_id: appId});
		apps = getAppTree(appId);
		if(!apps) {
			console.log("No such app wid ", appId)
			this.ready(); //If there is not such app.
			return;
		}
		console.log("Subscribing widgets: ", appId,  app.title, app.access)
		if(this.userId == app.owner || app.shareable || isAdmin(this.userId)) {
			// console.log("Returning screends: ", Screens.find({appId: appId}).fetch().length )
			return Widgets.find({appId: {$in: apps}});
		} else {
			return [];
		}
	});
	
	Meteor.publish("singleScreen", function(screenId) {
		scr = Screens.findOne({_id: screenId});
		app = Apps.findOne({_id: scr.appId});
		apps = getAppTree(scr.appId);
		if(!apps) {
			return [];
		}
		console.log("Subscribing single scren screens: ", scr.appId,  app.title, app.access)
		if(this.userId == app.owner || app.shareable || isAdmin(this.userId)) {
			// console.log("Returning screends: ", Screens.find({appId: appId}).fetch().length )
			return Screens.find({appId: {$in: apps}});
		} else {
			console.log("Attempt to access private app")
			return[];
		}
	});
	
	Meteor.publish("feeds", function(appId) {
		app = Apps.findOne({_id: appId});
		apps = getAppTree(appId);
		if(!apps) {
			console.log("No such app feed ", appId)
			this.ready(); //If there is not such app.
			return;
		}
		// console.log("Subscribing feeds: ", appId,  app.access)
		if(this.userId == app.owner || app.shareable || isAdmin(this.userId)) {
			// console.log("Returning feeds: ", Feeds.find({appId: appId}).fetch().length )
			return Feeds.find({appId: {$in
				
				: apps}});
		} else {
			return [];
		}
		// return Feeds.find({
		// 	$or: [{
		// 		owner: this.userId
		// 	}, {
		// 		public: true
		// 	}]
		// });
	});
	// Meteor.publish("feed", function(appId, feedId) {
	// 	app = Apps.findOne({_id: appId});
	// 	apps = getAppTree(appId);
	// 	// console.log("Subscribing feeds: ", appId,  app.access)
	// 	if(this.userId == app.owner || app.access == "Shareable") {
	// 		// console.log("Returning feeds: ", Feeds.find({appId: appId}).fetch().length )
	// 		return Feeds.find({_id: feedId, appId: {$in
				
	// 			: apps}});
	// 	}
	// 	// return Feeds.find({
	// 	// 	$or: [{
	// 	// 		owner: this.userId
	// 	// 	}, {
	// 	// 		public: true
	// 	// 	}]
	// 	// });
	// });
	Meteor.publish("themes", function(appId) {
		app = Apps.findOne({_id: appId});
		apps = getAppTree(appId);
		if(!apps) {
			console.log("No such app them ", appId)
			this.ready(); //If there is not such app.
			return;
		}
		// console.log("Subscribing themes: ", appId,  app.access)
		if(this.userId == app.owner || app.shareable || isAdmin(this.userId)) {
			// console.log("Returning themes: ", Themes.find({appId: appId}).fetch().length )
			return Themes.find({appId: {$in: apps}});
		} else {
			this.ready();
			return;
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
		return HelpPages.find({});
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
					username: 1,
					lastActivity: 1,
					idle: 1
				}
			});
		} else {
			this.ready();
		}

	});
	
	
	Meteor.publish("admins", function(){
		return Meteor.users.find({roles: "admin"});
	})
	
	

	Meteor.publish("userList", function() {
		user = Meteor.users.findOne({
			_id: this.userId
		});
		console.log("ADM : ", this.userId);
		if (user && user.roles && user.roles.indexOf('admin') > -1) {
			//console.log("ALLUSERS");
			return Meteor.users.find({}, {
				fields: {
					status: 1,
					username: 1
				}
			});
		} else {
			console.log("ULIST") 
			this.ready();
		}
	})
	

	Meteor.publish("syslogs", function() {
		user = Meteor.users.findOne({
			_id: this.userId
		});
		
		console.log("SLO : ", this.userId);
		if (user && user.roles && user.roles.indexOf('admin') > -1) {
			//console.log("ALLUSERS");
			return SysLogs.find({}, {sort: {date: -1}});
		} else {
			//console.log("ONEUSER") 
			this.ready();
		}
	});
	
	Meteor.publish("chats", function() {
		console.log("CHAT : ", this.userId);
		if(this.userId) {
			return Chats.find({});
		} else {
			console.log("CHATS") 
			this.ready();
		}
	});

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

	DocFiles = [
		"about-thing-studio.md",
		"apps.md",
		"attributes.md",
		"connections.md",
		"feeds.md",
		"helpers.md",
		"template-helpers.md",
		"templates.md",
		"themes.md",
		"widgets.md",
		"display-data.md",
		"data-in-and-out.md"
	];
	
	WidgetFiles = [
		"JustDial.json",
		"Sparkline.json",
		"StateButton.json"
	];

	num = Docs.remove({lastUpdated: null});
	//DocChanges.remove();
	console.log("Removed docs ", num);
	Meteor.publish("docs", function(){
		console.log("Subscribing Docs")
		return Docs.find();
	});
	
	Meteor.publish("doc_changes", function(){
		console.log("Subscribing DocChanges")
		return DocChanges.find();
	});
	FM = Meteor.npmRequire("front-matter");
	JsDiff = Meteor.npmRequire("diff");

	//Create all documentation and calculate changes
	console.log("docs", DocFiles)
	for(var f=0; f<DocFiles.length; f++){
		// console.log("Parsing: ", DocFiles[f]);
		a = Assets.getText("docs/"+DocFiles[f]);
		doc = FM(a);
		doc.filename = DocFiles[f];
		doc.lastUpdated = new Date();
		doc.newChanges =  true;
		//console.log("MYTXT ", FM(a));
		olddoc = Docs.findOne({filename: doc.filename});
		//check if the olddoc has changed.
		// console.log("Check docs ", doc.attributes, olddoc ? olddoc.attributes :"nothing" );

		if(olddoc) {
			//Workout what has changed	
			diffs = JsDiff.diffLines(olddoc.body, doc.body);
			for(var d=0; d<diffs.length; d++){
				diff = diffs[d];
				if(diff.added || diff.removed) {
					console.log("DIFFS: ", doc.filename, diff);
					DocChanges.insert({
						title: doc.attributes.title,
						file: doc.filename,
						diff: diff,
						date: new Date()
					})
				} else {
					console.log("NODIFF", doc.filename)
				}
			}
		}

		
		if(olddoc && olddoc.body == doc.body) {
			//Nothing has changed.
			Docs.update({filename: DocFiles[f]}, {$set: {newChanges: false}});
		} else {	
			Docs.upsert({filename: DocFiles[f]}, {$set: doc});
		}
		
		//console.log("DCOS: ",Docs.findOne());
	}

	//Update all system widgets.
	sysApp = Apps.findOne({_id: Meteor.settings.public.systemApp});
	if(!sysApp) {
		console.log("ERROR: No system app");
	} else {
		console.log("SYSAPP ", sysApp)
	}
	for(var w=0; w<WidgetFiles.length; w++){
		text = Assets.getText("widgets/"+WidgetFiles[w]);
		try {
			dump = JSON.parse(text);
		}
		catch(ev) {
			console.log("Widget Parsing failed on ", WidgetFiles[w], ev);
		}
		console.log("Widget Parse Success! ", WidgetFiles[w]);
		widgetObj = dump.widget;
		templateObj = dump.template;
		templateObj.appId = sysApp._id;
		templateObj.owner = sysApp.owner;
		templateObj.updatedAt = new Date();
		console.log("TMPO ", templateObj)
		res = Screens.upsert({title: templateObj.title}, {$set: templateObj}, {getAutoValues: false});
		console.log("TemplatUpsert ", res);
		baseScreen = Screens.findOne({title: templateObj.title});
		widgetObj.baseScreen = baseScreen._id;
		widgetObj.appId = sysApp._id;
		widgetObj.owner = sysApp.owner;
		res = Widgets.upsert({title: widgetObj.title}, {$set: widgetObj}, {getAutoValues: false});
		console.log("Widget Upsert", res);

	}

});

