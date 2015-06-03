Template.messages.helpers({
	template_list: function(feedname) {
		return Screens.find({isWidget: false});
	}
})