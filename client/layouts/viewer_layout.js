Template.ViewerLayout.events({
	'click .debug': function () {
		var showDebug = Meteor.users.findOne({_id: Meteor.userId()}).profile.showViewerDebug
		var showDebugReturn = showDebug ? false : true
		Meteor.users.update({
			_id: Meteor.userId()
		}, {
			$set: {
				"profile.showViewerDebug": showDebugReturn
			}
		});
		// if ( showDebug == true ) {
		// 	window.resizeTo(900,640)
		// } else {
		// 	window.resizeTo(360,640)
		// }

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
	showViewerDebug: function () {
		if ( !Meteor.isCordova ) {
			viewDebug = Meteor.users.findOne({_id: Meteor.userId()}).profile.showViewerDebug ? true : false
			// if ( viewDebug == true ) {
			// 	window.resizeTo(900,640)
			// } else {
			// 		window.resizeTo(360,640)
			// }
			return viewDebug;
		} else {
			console.log("PG: this is cordova, from showViewerDebug, returning false")
			return false;
		}
	},
	showDebugButton: function () {
		if ( !Meteor.isCordova ) {
			return true;
		} else {
			return false;
		}
	},
	debugOpenClass: function () {
		if ( Meteor.users.findOne({_id: Meteor.userId()}).profile.showViewerDebug == true ) {
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
