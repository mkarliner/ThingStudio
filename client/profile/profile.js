Template.Profile.helpers({
	gravatar: function(){
		return Gravatar.imageUrl(Meteor.user().emails[0].address);
	}
});