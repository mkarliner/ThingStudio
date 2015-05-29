IDEController = RouteController.extend({
	onBeforeAction: function() {
		console.log('IDEController OBA');
		if (!Meteor.user() && !Meteor.loggingIn()) {
			this.layout("HelpLayout");
			this.render("Login");
		} else {
			this.next();
		}
	},
	waitOn: function() {
		console.log('IDEController Subscribing')
		myCurrAppId = Session.get('currentAppId');
		return [
			Meteor.subscribe('apps'),
			Meteor.subscribe('connections', myCurrAppId),
			Meteor.subscribe('feeds', myCurrAppId),
			Meteor.subscribe('screens', myCurrAppId)
		]
	},
	data: function() {
		console.log("IDEController data")
		return {
			apps: Apps.find(),
			connections: Connections.find(),
			feeds: Feeds.find(),
			screens: Screens.find()
		}
	}
});

SingleAppController = IDEController.extend({
	data: function() {
		console.log("SingleAppController data")
		return Apps.find({ _id: this.params._id });
	}
});

SingleFeedController = IDEController.extend({
	data: function() {
		console.log("SingleFeedController data")
		return Feeds.find({ _id: this.params._id });
	}
});

SingleScreenController = IDEController.extend({
	data: function() {
		console.log("SingleScreenController data")
		Session.set("currentScreenPage", this.params._id);
		return Screens.find({ _id: this.params._id });
	}
});

SingleThemeController = IDEController.extend({
	data: function() {
		console.log("SingleThemeController data")
		Session.set("currentTheme", this.params._id);
		return Themes.find({ _id: this.params._id });
	}
});

ProfileController = IDEController.extend({
	subscriptions: function() {
		console.log("ProfileController subscribe")
		Meteor.subscribe("userData");
	},
	data: function() {
		console.log("ProfileController data")
		return Meteor.user();
	}
});

DocsController = IDEController.extend({
	subscriptions: function() {
		console.log("DocsController subscriptions")
		Meteor.subscribe("help_pages");
	},
	data: function() {
		console.log("DocsController data")
		return Meteor.user();
	}
});

SingleDocController = DocsController.extend({
	data: function() {
		console.log("SingleDocController data")
		return HelpPages.find({ urlstring: this.params.urlstring });
	}
});