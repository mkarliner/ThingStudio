Router.configure({
	layoutTemplate: function() {
		return 'GeneralLayout';
	}
});

AccountsTemplates.configureRoute('signIn');

Router.onBeforeAction(function() {
	console.log("Signup");
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
			return Screens.findOne({_id: this.params._id});
		}
	});
});

Router.route("/screens", function(){
	this.render("Screens");
});

Router.route("/feeds", function(){
	this.render("Feeds");
});