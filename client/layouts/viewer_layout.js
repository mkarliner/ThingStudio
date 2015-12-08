Template.ViewerLayout.events({
	// Don't set event maps on layouts!
});

Template.AppFooter.events({
	'click a.debug': function () {
		if ( Session.get( "debugOpen", true ) ) {
			Session.set( "debugOpen", false )
		} else {
			Session.set( "debugOpen", true )
		}
	}
})

Template.AppFooter.helpers({
	appPathInfo: function(){
		return {appid: Session.get("currentAppId")}
	},

})

Template.ViewerLayout.helpers({
	isConnected: function() {
		if ( Session.get( "ConnectionStatus" ) == true ) {
			return 'connected';
		} else {
			return 'disconnected';
		}
	},
	showMQTTStatus: function(){
		app = getCurrentApp();
		if( !app ) { return false; }
		if( app.connection == "none" || !app.connection ) {
			return false;
		} else {
			return true;
		}
	},
	appHamburger: function() {
		appId = Session.get( "currentAppId" )
		app = Apps.findOne( {_id: appId} )
		if ( !app ) { return }
		showMenu = app.showHamburger
		screenCount = Screens.find({ isWidget: false }).count()
		if ( !showMenu ||  screenCount < 2 ) {
			// Hide the nav
			return 'hide-app-nav'
		} else {
			// Show the nav
			return ''
		}
	},
	appCSS: function () {
		app = Apps.findOne( {_id: Session.get( "currentAppId" ) } )
		if ( !app ) { return }
		if ( app.css ) {
			return app.css
		} else {
			return
		}
	},
	screenlist: function(){
		return Screens.find({ isWidget: false })
	},
	runtimeErrors: function(){
		return Session.get( "runtimeErrors" );
	},
	debugOpen: function () {
		return Session.get( "debugOpen" )
	},
	debugState: function () {
		if ( Session.get( "debugOpen", true ) ) {
			return 'debug-open';
		} else {
			return 'debug-closed';
		}
	}
	// log: function () {
	// 	var hithere = Session.get("currentAppId")
	// 	console.log('Here is this in the viewer', hithere)
	// }
})
