AppViewerController = RouteController.extend({
	layoutTemplate: "ViewerLayout",
	loadingTemplate: "Loading",
	subscriptions: function() {
		console.log("WAITON")
		var appId = Session.get("currentAppId");
		if(appId){
			return [
				Meteor.subscribe('apps', appId),
				Meteor.subscribe('connections', appId, {
					onReady: function(){
						console.log("Connections READY!");
					}
				}),
				Meteor.subscribe('feeds', appId),
				Meteor.subscribe('screens', appId)
				// Meteor.subscribe('themes', appId),
			];
		} else {
			return Meteor.subscribe("apps");
		}

	}
});