Template.EditHttpFeedBody.onRendered(function() {
    $('ul.tabs').tabs();
});

Template.EditHttpFeedHeader.helpers({
	thisfeed: function() {
		return this.title;
	},
	feedHeader: function() {
		return this.title + ": " + this.subscription;
	}
});