AppViewerController = PreloadController.extend({
	layoutTemplate: "ViewerLayout",
	'preload': {
		'styles': ['/css/viewer.css']
	},
	loadingTemplate: "Loading",
	onBeforeAction: function() {
		$('body').addClass('viewer-body');
		if(this.params.appid) {
			Session.setPersistent("currentAppId", this.params.appid);
		}
        //Do not call this.next() SetMQTTCredentials does that.
	        SetMQTTCredentials(this);
        	inIDE = false;
		//this.next();
	},
	subscriptions: function() {
		// console.log("WAITON")
		var appId = Session.get("currentAppId");
		if(appId){
			return [
				Meteor.subscribe('apps', appId, {
					onReady: function(){
						InitialiseApps();
					}
				}),
				Meteor.subscribe('connections', appId, {
					onReady: function(){
						// console.log("Connections READY!");
					}
				}),
				Meteor.subscribe('http_connections', appId),
				Meteor.subscribe('feeds', appId, {
					onReady: function(){
						// console.log("Feeds READY!");
					}
				}),
				Meteor.subscribe('http_feeds', appId),
				Meteor.subscribe('screens', appId, {
					onReady: function(){
						// console.log("Screens READY!");
					}
				}),
				Meteor.subscribe('widgets', appId, {
					onReady: function(){
						// console.log("Screens READY!");
						InstantiateWidgets();
					}
				}),
				Meteor.subscribe('themes', appId, {
					onReady: function(){
						// console.log("Themes READY!");
					}
				})
				// Meteor.subscribe('themes', appId),
			];
		} else {
			// screenId = Session.get("currentScreenId");
			console.log("You don't have an app ID. Weird.")
			// return Meteor.subscribe("singleScreen", screenId);
			return false;
		}

	}
});
