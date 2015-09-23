IDEController = PreloadController.extend({
	layoutTemplate: "MasterLayout",
	'preload': {
		'styles': ['/css/materialize.css', '/css/ide.css'],
		'sync': ['/js/materialize.js'],
		'onBeforeSync': function ( fileName ) {
        // Return 'true' to continue normally, otherwise skip library
				console.log("IDE onBeforeSync", fileName)
				return true;
    },

    // (optional) User-defined method called on each synchronously
    // loaded library to check whether it finished initialization
    'onSync' : function ( fileName ) {
        // Check and return `true` if `fileName` finished initialization
				console.log("IDE onSync", fileName)
				return true;
    },

    // (optional) User-defined method called AFTER each synchronously
    // loaded library to allow additional processing
    'onAfterSync': function ( fileName ) {
        // Return 'true' to continue normally,
        // otherwise don't mark library as loaded
				console.log("IDE onAfterSync", fileName)
				return true;
    }
	},
	onBeforeAction: function() {
		$('body').removeClass('viewer-body');
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
			Meteor.subscribe('sharedApps'),
			Meteor.subscribe("apps", {
				onReady: function(){
					//Are we logged in.
					if (!Meteor.userId()) {
						console.log("Not logged in at startup - bailing.")
						return;
					}
					InitialiseApps();
					initialApp = Session.get("currentAppId");
					ia = Apps.findOne({_id: initialApp})
					console.log("Initial App on Startup ", initialApp, ia);
					if(initialApp && ia) {
						console.log("Found initial app ", initialApp)
						return;
					} else {
						Session.setPersistent("currentAppId", null);
					}
					console.log("Apps Ready", Apps.find({}).fetch());
					//Is there only one App available?
					numApps = Apps.find({owner: Meteor.userId()}).count();
					if(numApps == 1) {
						initialApp = Apps.findOne();
						Session.setPersistent("currentAppId", initialApp._id);
						return;
					}
					//Are we logged in, but have no Apps?
					if(Meteor.userId() && numApps == 0) {
						//If so, create first app.
						console.log("Creating default app on ready", Meteor.userId())
						appId = Apps.insert({
							title: "My First App",
							shareable: false,
						});
						Session.setPersistent("currentAppId", appId);
						return;
					}
					//Are we logged in, with Apps, but none current?
					//Just choose the any app.
					if(Meteor.userId) {
						initialApp = Apps.findOne();
						Session.setPersistent("currentAppId", initialApp._id);
						return;
					}

				}
			}),
			Meteor.subscribe('connections', myCurrAppId),
			Meteor.subscribe('http_connections', myCurrAppId),
			Meteor.subscribe('feeds', myCurrAppId),
			Meteor.subscribe('http_feeds', myCurrAppId),
			Meteor.subscribe('screens', myCurrAppId),
			Meteor.subscribe('widgets', myCurrAppId, {
				onReady: function(){
					InstantiateWidgets();
				}
			}),
			Meteor.subscribe('themes', myCurrAppId),
			Meteor.subscribe('userList'),
			Meteor.subscribe('syslogs'),
			Meteor.subscribe('chats', {
				onReady: function(){
					Meteor.autorun(function(){
						Chats.find({}, {limit: 1, sort:{ date: -1}}).observeChanges({
							addedBefore: function(id, fields, before) {
								username = Meteor.user().username;
								console.log("ADDED: message ", id, fields.message, username, before);
								users = fields.message.match(/@([a-zA-Z0-9_-]+)\s/g)
								console.log("USERS: ", users)
								chats = Chats.find().count();
								if(Session.get("chatsReady") == true) {
									sound = new Audio('ding.mp3')
									sound.volume = 0.2
									//sound.play();
									Session.set("newChats", true);
								}
							}
						})
						Session.set("chatsReady", true);
					})
				}
			}),
			Meteor.subscribe('admins'),
			Meteor.subscribe("docs"),
			Meteor.subscribe("doc_changes")
		]
	}
});

Meteor.autorun(function(){
	if(Session.get("newChats") == true){
		console.log("Setting chat timeout")
		Meteor.setTimeout(function(){
			console.log("Setting newchats false")
			Session.set("newChats", false);
		},  60 * 1000)
	}
})

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
