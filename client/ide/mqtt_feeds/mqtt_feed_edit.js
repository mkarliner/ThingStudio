Template.EditMqttFeedBody.onRendered(function() {
    $('ul.tabs').tabs();
});

Template.EditMqttFeedHeader.helpers({
	thisfeed: function() {
		return this.title;
	},
	feedHeader: function() {
		return this.title + ": " + this.subscription;
	}
});
