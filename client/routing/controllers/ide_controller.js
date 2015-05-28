IDEController = RouteController.extend({
	layoutTemplate: 'MasterLayout',
	onBeforeAction: function() {
		if (!Meteor.user() && !Meteor.loggingIn()) {
			this.layout("HelpLayout");
			this.render("Login");
		} else {
			this.next();
		}
	},
	subscriptions: function() {
		myCurrAppId = Session.get('currentApp')._id;
		return [
			Meteor.subscribe('apps'),
			Meteor.subscribe('connections', myCurrAppId),
			Meteor.subscribe('feeds', myCurrAppId),
			Meteor.subscribe('screens', myCurrAppId)
		]
	},
	data: function() {
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
		return Apps.findOne({ _id: this.params._id });
	}
});

SingleFeedController = IDEController.extend({
	data: function() {
		return Feeds.findOne({ _id: this.params._id });
	}
});

SingleScreenController = IDEController.extend({
	data: function() {
		Session.set("currentScreenPage", this.params._id);
		return Screens.findOne({ _id: this.params._id });
	}
});

SingleThemeController = IDEController.extend({
	data: function() {
		Session.set("currentTheme", this.params._id);
		return Themes.findOne({ _id: this.params._id });
	}
});

ProfileController = IDEController.extend({
	data: function() {
		return Meteor.user();
	}
});

DocsController = IDEController.extend({
	subscriptions: function() {
		Meteor.subscribe("help_pages");
	},
	data: function() {
		return Meteor.user();
	}
});

SingleDocController = DocsController.extend({
	data: function() {
		return HelpPages.findOne({ urlstring: this.params.urlstring });
	}
});