Template.Themes.helpers({
	themelist: function(){
		console.log("themes")
		return Themes.find({})
	}
});

Template.Themes.events({
	"click .themelink": function(ev) {
		console.log(this);
		Router.go("/themes/" + this._id);
	}
})