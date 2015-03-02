Router.configure({
	layoutTemplate: function() {
		return 'GeneralLayout';
	}
});

AccountsTemplates.configureRoute('signIn');


Router.onBeforeAction(function() {
	if (!Meteor.user()) {
		this.layout("HelpLayout");
		this.render("Login");
		this.next();
	} else {
		this.render("/viewermenu")
		this.next();
	}
}, { except: ["/", "/help/about"]});



Router.route("/", function(){
	if (Meteor.user()  ) {
		this.layout("ViewerLayout");
		this.render("ViewerMenu");
	} else {
		this.layout('HomeLayout');
		this.render("Home");
	}
});

Router.route("/logout", function(){
	AccountsTemplates.logout();
})


Router.route("/home", function(){
	this.layout("HelpLayout")
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
			Session.set("currentScreenPage", this.params._id);
			return Screens.findOne({_id: this.params._id});
		}
	});
});

Router.route("/screens", function(){
	this.layout("GeneralLayout");
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

Router.route("/help/about", function(){
	this.layout("HelpLayout");
	this.render("HelpAbout");
});
