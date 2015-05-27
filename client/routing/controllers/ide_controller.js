IDEController = RouteController.extend({

	waitOn: function() {
		myCurrAppId = Session.get('currentApp')._id;
		console.log('PG: subscription app ID: ' + myCurrAppId);
		return [
			Meteor.subscribe('apps', 'myCurrAppId'),
			Meteor.subscribe('feed', 'myCurrAppId', this.params._id)
		]

	},
	data: function() {
		return Feeds.findOne({	_id: this.params._id	});
	},
	dashboard: function() {
		u = Meteor.user();
		if (u) {
			if (u.profile && u.profile.showWelcome) {
				this.redirect("/welcome");
			} else {
				this.render("DashboardBody");
			}
		}
	},
	action: function() {
		this.render('BreadcrumbsContent', { to: 'breadcrumbs' });
		this.render("ViewFeedHeader", { to: "appHeader" });
		this.render("ViewFeedBody");
	}
});