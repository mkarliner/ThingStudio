Router.configure({
	layoutTemplate: function() {
		return 'GeneralLayout';
	}
});



Router.route("/", function(){
	if (Meteor.user()) {
		Router.go("/home");
	} else {
		this.render("Login");
	}
});


Router.route("/home", function(){
	this.render("Home");
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