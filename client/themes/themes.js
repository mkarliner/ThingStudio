Template.Themes.helpers({
	themelist: function(){
		return Themes.find({})
	}
});

Template.Themes.events({
	"click .themelink": function(ev) {
		Router.go("/themes/" + this._id);
	}
})