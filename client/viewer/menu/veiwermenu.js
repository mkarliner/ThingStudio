Template.ViewerMenu.helpers({
	screenlist: function(){
		console.log("screens")
		return Screens.find({})
	}
});

Template.ViewerMenu.events({
	"click .screenlink": function(ev) {
		console.log("SCRL", this);
		Router.go("/app/"+this.appid + "/screen/" + this._id);
	},
	"click .studiolink": function(ev) {
		Router.go("/screens");
	}
});

