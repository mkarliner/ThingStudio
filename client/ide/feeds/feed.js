Template.EditFeedBody.onRendered(function() {
    $('ul.tabs').tabs();
});

Template.EditFeedHeader.helpers({
	thisfeed: function() {
		return this.title;
	},
	feedHeader: function() {
		return this.title + ": " + this.subscription;
	}
});
