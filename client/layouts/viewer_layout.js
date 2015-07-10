Template.ViewerLayout.onRendered(function() {
	$(".button-collapse").sideNav();
});

Template.ViewerLayout.helpers({
	appHamburger: function() {
		appId = Session.get("currentAppId")
		app = Apps.findOne({_id: appId})
		if ( !app ) { return }
		showMenu = app.showHamburger
		screenCount = Screens.find({}).count()
		console.log('screencount', screenCount)
		if ( !showMenu ||  screenCount < 2) {
			// Hide the nav
			return 'hide-app-nav'
		} else {
			// Show the nav
			return ''
		}
	},
	screenlist: function(){
		return Screens.find({})
	},
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	},
	isConnected: function() {
		if ( Session.get( "ConnectionStatus" ) == true ) {
			return 'connected';
		} else {
			return 'disconnected';
		}
	}
})