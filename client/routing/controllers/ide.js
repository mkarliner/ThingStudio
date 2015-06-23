IDEController = RouteController.extend({
	layoutTemplate: "MasterLayout",
	onBeforeAction: function() {
		if (!Meteor.user() && !Meteor.loggingIn()) {
			this.layout("HelpLayout");
			// this.render("Login");
			this.next();
		} else {
			this.next();
		}
	},
	subscriptions: function() {
		myCurrAppId = Session.get('currentAppId');
		guestAppId = Session.get('guestAppId');
		return [
			Meteor.subscribe("apps", {
				onReady: function(){
					//Are we logged in.
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
							shareable: false,
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
			}),
			Meteor.subscribe('connections', myCurrAppId),
			Meteor.subscribe('feeds', myCurrAppId),
			Meteor.subscribe('screens', myCurrAppId),
			Meteor.subscribe('widgets', myCurrAppId),
			Meteor.subscribe('themes', myCurrAppId),
			Meteor.subscribe('userList'),
			Meteor.subscribe('syslogs'),
			Meteor.subscribe('chats'),
			Meteor.subscribe('admins')
		]
	}
});

ProfileController = IDEController.extend({
	subscriptions: function() {
		console.log("ProfileController subscribe")
		Meteor.subscribe("userData");
	},

});

OldDocsController = IDEController.extend({
	subscriptions: function() {
		//console.log("OldDocsController subscriptions")
		Meteor.subscribe("help_pages")		
	}
});

DocsController = IDEController.extend({
	subscriptions: function() {
		//console.log("DocsController subscriptions")
		Meteor.subscribe("docs")		
	}
});