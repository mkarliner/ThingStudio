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
			Meteor.subscribe('feeds', myCurrAppId)
		]
	},
	data: function() {
		return Feeds.findOne({	_id: this.params._id	});
	},
	action: function() {
		this.render('BreadcrumbsContent', { to: 'breadcrumbs' });
		this.render("ViewFeedHeader", { to: "appHeader" });
		this.render("ViewFeedBody");
	}
});