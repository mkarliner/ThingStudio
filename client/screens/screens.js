Template.Screens.helpers({
	screenlist: function(){
		return Screens.find({ owner: Meteor.userId()})
	},
	publicscreens: function() {
		return Screens.find({public: true})
	},
	allscreens: function() {
		return Screens.find({})
	},
	status: function(){
		if(this.owner == Meteor.userId()) {
			return "Owner";
		} else {
			u = Meteor.users.findOne(this.owner);
			return u ? u.username : "Unknown";
		}
	},
	home_page: function(){
		app = Session.get("currentApp");
		return  this._id == app.home_page ? "yes" : "no";
	}
});

Template.Screens.events({
	"click .screenlink": function(ev) {
		console.log(this);
		Router.go("/screens/" + this._id);
	}
})


InstantiateScreens = function(){
	//Instantiate all screens
	scrs = Screens.find().fetch();
	for(var s=0; s<scrs.length; s++){
		scr = scrs[s];
		console.log("Compiling ", scr.title);
		compileTemplate(scr.title, scr.html);
		if(scr.isWidget) {
			Template[scr.title].registerElement(scr.widgetName);
		}
	}
}