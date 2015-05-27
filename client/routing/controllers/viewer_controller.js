AppViewerController = RouteController.extend({
	layoutTemplate: "ViewerLayout",
	subscriptions: function() {
		console.log("WAITON")
		var appId = Session.get("currentAppId");
		return [
			Meteor.subscribe('apps', appId),
			Meteor.subscribe('connections', appId),
			Meteor.subscribe('feeds', appId),
			Meteor.subscribe('screens', appId),
			// Meteor.subscribe('themes', appId),
		]
	}
});