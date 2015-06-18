Template.EditFeedBody.onRendered(function() {
    $('ul.tabs').tabs();
    $('select').material_select();
});

Template.EditFeedHeader.helpers({
	thisfeed: function() {
		return this.title;
	},
	feedHeader: function() {
		return this.title + ": " + this.subscription;
	}
});