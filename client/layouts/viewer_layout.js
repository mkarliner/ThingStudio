Template.appheader.registerElement('app-header');
Template.appfooter.registerElement('app-footer');

Template.ViewerLayout.onRendered(function() {
	$(".button-collapse").sideNav();
});

Template.ViewerLayout.helpers({
	appHamburger: function() {
		appId = Session.get("currentAppId")
		app = Apps.findOne({_id: appId})
		if ( !app ) { return }
		showMenu = app.showHamburger
		screenCount = Screens.find({isWidget: false}).count()
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
		return Screens.find({isWidget: false})
	},
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	}
})

Template.appheader.helpers({
	isConnected: function() {
		if ( Session.get( "ConnectionStatus" ) == true ) {
			return 'connected';
		} else {
			return 'disconnected';
		}
	}
})
