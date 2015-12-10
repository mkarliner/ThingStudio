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
					event: "PageView",
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

					// Grab the current App ID & App object
					initialApp = Session.get( "currentAppId" );
					ia = Apps.findOne( { _id: initialApp } )

					// Just navigating around? Move along.
					if( initialApp && ia ) {
						return;
					} else {
						// What specific case does this handle?
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

					//Are we logged in, with Apps, but none current? Just choose any app.
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
		]
	}
});

ProfileController = IDEController.extend({
	subscriptions: function() {
		// console.log("ProfileController subscribe")
		Meteor.subscribe( "userData" );
	}
});
