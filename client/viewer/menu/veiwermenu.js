Template.ViewerMenu.helpers({
	screenlist: function(){
		console.log("screens")
		return Screens.find({})
	}
});

Template.ViewerMenu.events({
	"click .screenlink": function(ev) {
		console.log(this);
		Router.go("/viewer/screen/" + this._id);
	}
});

