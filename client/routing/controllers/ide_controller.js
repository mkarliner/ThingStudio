IDEController = RouteController.extend({
	
	onBeforeAction: function() {
		console.log("BA IDE", Meteor.user())
		if (!Meteor.user() && !Meteor.loggingIn()) {
			this.layout("HelpLayout");
			this.render("Login");
		} else {
			this.next();
		}
	},
	subscriptions: function() {
		myCurrAppId = Session.get('currentApp')._id;
		console.log('PG: subscription app ID: ' + myCurrAppId);
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