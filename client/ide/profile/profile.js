Template.ProfileHeader.helpers({
	username: function() {
		return Meteor.user().username;
	}
});