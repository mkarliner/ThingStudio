Template.ScreensHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
		$('.add-new-item select').material_select();
	}
});

Template.ScreensNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		menuOps();
	}
});

// Template.ScreensBody.events({
// 	"click .screenlink": function(ev) {
// 		console.log(this);
// 		Router.go("/screens/" + this._id);
// 	}
// })

Template.ScreensBody.helpers({
	widgetlist: function(){
		wl =  Screens.find({ owner: Meteor.userId(), isWidget: true})
		return wl;
	},
	screenlist: function(){
		return Screens.find({ owner: Meteor.userId()})
	},
	owner: function() {
		return 
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
	fromApp: function(){
		app = Apps.findOne(this.appId);
		return app.title;
	},
	home_page: function(){
		app = Session.get("currentApp");
		return  this._id == app.home_page ? "yes" : "no";
	},
	widget: function(){
		return( "aa" +this.isWidget)
	}
});

InstantiateScreens = function(){
	//Instantiate all screens which are widgets
	scrs = Screens.find().fetch();
	for(var s=0; s<scrs.length; s++){
		scr = scrs[s];
		if(scr.isWidget) {
			console.log("Compiling ", scr.title);
			compileTemplate(scr.title, scr.html, scr.js);
			try {
				console.log("Registering widget")
				Template[scr.title].registerElement(scr.widgetName);
			}
			catch(err) {
				console.log("Register Element: ", err);
			}
			
		}
	}
}