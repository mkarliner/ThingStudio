Template.Screens.helpers({
	screenlist: function(){
		console.log("screens")
		return Screens.find({})
	}
});

Template.Screens.events({
	"click .screenlink": function(ev) {
		console.log(this);
		Router.go("/screens/" + this._id);
	}
})