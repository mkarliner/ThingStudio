Template.ViewerLayout.events({
	'click a.debug': function () {
		if ( Session.get( "debugOpen", true ) ) {
			Session.set( "debugOpen", false )
		} else {
			Session.set( "debugOpen", true )
		}
	},
	'click .route': function () {
		Session.set( "debugOpen", false )
	}
});

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
		if(!app) {
			return false;
		}
		console.log("showMQTTSTATS", app.connection, app.title)
		if( app.connection == "none" || !app.connection ) {
			return false;
		} else {
		return true;
		}
	},
	appHamburger: function() {
		appId = Session.get("currentAppId")
		app = Apps.findOne({_id: appId})
		if ( !app ) { return }
		showMenu = app.showHamburger
		screenCount = Screens.find({isWidget: false}).count()
		// console.log('screencount', screenCount)
		if ( !showMenu ||  screenCount < 2) {
			// Hide the nav
			return 'hide-app-nav'
		} else {
			// Show the nav
			return ''
		}
	},
	screenlist: function(){
		return Screens.find({isWidget: false})
	},
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	},
	appPathInfo: function(){
		return {appid: Session.get("currentAppId")}
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
