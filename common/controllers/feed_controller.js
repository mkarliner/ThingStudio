FeedController = RouteController.extend({
	layoutTemplate: 'MasterLayout',

	subscriptions: function() {
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
	action: function() {
		// if ( this.ready() ) {
			this.render('BreadcrumbsContent', { to: 'breadcrumbs' });
			this.render("ViewFeedHeader", { to: "appHeader" });
			this.render("ViewFeedBody");
		// } else {
		// 	this.render("Loading");
		// }
	}
});