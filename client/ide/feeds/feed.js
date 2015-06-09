Template.ViewFeedBody.onRendered(function() {
    $('ul.tabs').tabs();
    $('select').material_select();
});

Template.ViewFeedHeader.helpers({
	thisfeed: function() {
		return this.title;
	},
	feedHeader: function() {
		return this.title + ": " + this.subscription;
	}
});