Template.Users.helpers({
	num_feeds: function(userId) {
		return Feeds.find({owner: userId}).count()
	}
});