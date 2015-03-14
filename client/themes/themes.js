Template.Themes.helpers({
	themelist: function(){
		return Themes.find({})
	},
	status: function(){
		if(this.owner == Meteor.userId()) {
			return "Owner";
		} else if(this.public == true) {
			return("Public read-only")
		} else {
			return "Shouldn't happen"
		}
	}
});

Template.Themes.events({
	"click .themelink": function(ev) {
		console.log("Theme click")
		Router.go("/themes/" + this._id);
	}
})