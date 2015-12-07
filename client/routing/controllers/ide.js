IDEController = PreloadController.extend({
	layoutTemplate: "MasterLayout",
	'preload': {
		'styles': [ '/css/materialize.css', '/css/ide.css' ],
		'sync': [ '/js/materialize.js' ],
	},
	onBeforeAction: function() {
		$( 'body' ).removeClass( 'viewer-body' );
		if ( !Meteor.user() && !Meteor.loggingIn() ) {
			this.layout( "LoginLayout" );
			this.next();
		} else {
			if( trackUser( Meteor.user() ) ) {
        app = getCurrentApp()
        title = app ? app.title : "none"
				SysLogs.insert({
					event: "UserAction",
					title: "App: " + title,
					id: null,
					userName: Meteor.user().username,
					details: this.url,
					date: new Date()
				});
			}
			this.next();
		}
	},
	subscriptions: function() {
		myCurrAppId = Session.get( 'currentAppId' );
		guestAppId = Session.get( 'guestAppId' );
		return [
			Meteor.subscribe( 'sharedApps' ),
			Meteor.subscribe( "apps", {
				onReady: function(){
					// NEEDS REFACTORING BIG TIME!

					// Are we logged in?
					if (!Meteor.userId()) {
						return;
					}

					// ??
					initialApp = Session.get( "currentAppId" );
					ia = Apps.findOne( { _id: initialApp } )
					if( initialApp && ia ) {
						return;
					} else {
						Session.setPersistent( "currentAppId", null );
					}

					// Is there only one App available WHICH THE USERS OWNS?
					numApps = Apps.find( { owner: Meteor.userId() } ).count();
					if( numApps == 1 ) {
						initialApp = Apps.findOne();
						Session.setPersistent( "currentAppId", initialApp._id );
						return;
					}

					//Are we logged in, but have no Apps?
					if( Meteor.userId() && numApps == 0 ) {
						exampleAppId = Meteor.settings.public.basicExampleApp
						Session.setPersistent( "currentAppId", exampleAppId );
						return;
					}

					//Are we logged in, with Apps, but none current?
					//Just choose any app.
					if( Meteor.userId() ) {
						initialApp = Apps.findOne();
						Session.setPersistent( "currentAppId", initialApp._id );
						return;
					}
				}
			}),
			Meteor.subscribe( 'connections', myCurrAppId ),
			Meteor.subscribe( 'http_connections', myCurrAppId ),
			Meteor.subscribe( 'feeds', myCurrAppId ),
			Meteor.subscribe( 'http_feeds', myCurrAppId ),
			Meteor.subscribe( 'screens', myCurrAppId ),
			Meteor.subscribe( 'widgets', myCurrAppId, {
				onReady: function(){
					InstantiateWidgets();
				}
			}),
			Meteor.subscribe( 'userList' ),
			Meteor.subscribe( 'syslogs' ),
			Meteor.subscribe( 'admins' ),
			Meteor.subscribe( "docs" ),
			Meteor.subscribe( "doc_changes" )
			// Meteor.subscribe('themes', myCurrAppId),

			// Meteor.subscribe('chats', {
			// 	onReady: function(){
			// 		Meteor.autorun(function(){
			// 			Chats.find({}, {limit: 1, sort:{ date: -1}}).observeChanges({
			// 				addedBefore: function(id, fields, before) {
			// 					username = Meteor.user().username;
			// 					// console.log("ADDED: message ", id, fields.message, username, before);
			// 					users = fields.message.match(/@([a-zA-Z0-9_-]+)\s/g)
			// 					// console.log("USERS: ", users)
			// 					chats = Chats.find().count();
			// 					if(Session.get("chatsReady") == true) {
			// 						sound = new Audio('ding.mp3')
			// 						sound.volume = 0.2
			// 						//sound.play();
			// 						Session.set("newChats", true);
			// 					}
			// 				}
			// 			})
			// 			Session.set("chatsReady", true);
			// 		})
			// 	}
			// }),

		]
	}
});

// Meteor.autorun(function(){
// 	if(Session.get("newChats") == true){
// 		console.log("Setting chat timeout")
// 		Meteor.setTimeout(function(){
// 			console.log("Setting newchats false")
// 			Session.set("newChats", false);
// 		},  60 * 1000)
// 	}
// })

ProfileController = IDEController.extend({
	subscriptions: function() {
		// console.log("ProfileController subscribe")
		Meteor.subscribe( "userData" );
	},

});
