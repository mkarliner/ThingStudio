Template.Owner.helpers({
	ownerName: function(){
		user = Meteor.users.findOne({_id: this.toString()});
		return(user.emails[0].address);
	}
});