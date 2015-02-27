Router.configure({
	layoutTemplate: function() {
		return 'GeneralLayout';
	}
});

AccountsTemplates.configureRoute('signIn');


Router.onBeforeAction(function() {
	if (!Meteor.user()) {
		this.render("Login");
		this.next();
	} else {
		this.next();
	}
}, { except: ["help"]});



Router.route("/", function(){
	if (Meteor.user()) {
		Router.go("/viewermenu");
	} else {
		this.render("Login");
	}
});

Router.route("/logout", function(){
	AccountsTemplates.logout();
})


Router.route("/home", function(){
	this.render("Home");
});

Router.route("/viewermenu", function(){
	this.layout('ViewerLayout');
	this.render("ViewerMenu");
});

Router.route("/viewer/screen/:_id", function(){
	this.layout('ViewerLayout');
	this.render("ViewScreen", {
		data: function(){
			Session.set("currentScreenPage", this.params._id);
			return Screens.findOne({_id: this.params._id});
		}
	});
});


Router.route("/connexions", function(){
	this.render("Connexions");
});

Router.route("/screens/:_id", function(){
	this.render("Screen", {
		data: function(){
			console.log("Setting Current Screen", this.params._id);
			Session.set("currentScreenPage", this.params._id);
			return Screens.findOne({_id: this.params._id});
		}
	});
});

Router.route("/screens", function(){
	this.render("Screens");
});

Router.route("/themes/:_id", function(){
	this.render("Theme", {
		data: function(){
			Session.set("currentTheme", this.params._id);
			return Themes.findOne({_id: this.params._id});
		}
	});
});

Router.route("/themes", function(){
	this.render("Themes");
});

Router.route("/feeds", function(){
	this.render("Feeds");
});