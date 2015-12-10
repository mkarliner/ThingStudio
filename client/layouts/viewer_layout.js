Template.ViewerLayout.events({
	// Don't set event maps on layouts!
});

Template.AppHeader.helpers({
	appHasMQTTConnection: function() {
		app = getCurrentApp()
		if( !app ) { return false; }
		if( app.connection == "none" || !app.connection ) {
			return false
		} else {
			return true
		}
	},
	isConnected: function() {
		if ( Session.get( "ConnectionStatus" ) == true ) {
			return 'connected'
		} else {
			return 'disconnected'
		}
	}
})

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
	appPathInfo: function() {
		return { appid: Session.get( "currentAppId" ) }
	},
	debugOpen: function () {
		return Session.get( "debugOpen" )
	}
})

Template.ViewerLayout.helpers({
	// appHamburger: function() {
	// 	appId = Session.get( "currentAppId" )
	// 	app = Apps.findOne( { _id: appId } )
	// 	if ( !app ) { return }
	// 	showMenu = app.showHamburger
	// 	screenCount = Screens.find( { isWidget: false } ).count()
	// 	if ( !showMenu ||  screenCount < 2 ) {
	// 		// Hide the nav
	// 		return 'hide-app-nav'
	// 	} else {
	// 		// Show the nav
	// 		return ''
	// 	}
	// },
	appCSS: function () {
		app = Apps.findOne( {_id: Session.get( "currentAppId" ) } )
		if ( !app ) { return }
		if ( app.css ) {
			return app.css
		} else {
			return
		}
	},
	debugState: function () {
		if ( Session.get( "debugOpen", true ) ) {
			return 'debug-open'
		} else {
			return 'debug-closed'
		}
	}
})
