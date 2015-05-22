Template.registerHelper( 
	"gravatar", function(){
		return Gravatar.imageUrl(Meteor.user().emails[0].address);
	}
);