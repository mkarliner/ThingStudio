Router.configure({
	layoutTemplate: function() {
		return 'GeneralLayout';
	}
});

AccountsTemplates.configureRoute('signIn');


Router.onBeforeAction(function(par) {
	// console.log("Before action", par);
	if (!Meteor.user() && !Meteor.loggingIn() ) {
		this.layout("HelpLayout");
		this.render("Login");
	} else {
		this.next();
	}
}, { except: ["Home", "Help", "Helppages"]});



Router.route("/", function(){
	u = Meteor.user();
	if (u) {
		if(u.profile && u.profile.showWelcome) {
			this.redirect("/welcome");
		} else {
			this.redirect("Screens");
		}
	} else {
		this.layout('HomeLayout');
		this.render("Home");
	}
}, {
	name: "Home"
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


Router.route("/connections", function(){
	this.render("Connections");
});

Router.route("/connection", function(){
	this.layout("GeneralLayout");
	this.wait(Meteor.subscribe("connections"));
	if(this.ready()){
		this.render("Connection", {
			data: function(){
				console.log("CONN", Connections.findOne());
				conn = Connections.findOne();
				if(conn) {
					return conn;
				} else {
					Connections.insert({
						title: "Modern Industry", 
						host: "mqtt.thingstud.io", 
						port: 9001, protocol: "Websocket", 
						owner: Meteor.userId(),
						username: "guest",
						password: "guest",
						autoConnect: true});
					return Connections.findOne();
				}
				
			}
		})
	}
		
});


Router.route("/screens/:_id", function(){
	this.layout("GeneralLayout");
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
}, {
	name: "Screens"
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

Router.route("/docs/about", function(){
	this.layout("HelpLayout");
	this.render("HelpAbout");
});

Router.route("/debug", function(){
	this.render("Debug");
});

Router.route("/docs", function() {
	this.layout("HelpContainer");
	this.render("HelpMenu");
	
}, {
	name: "Docs"
});

Router.route("/docs/:urlstring", function(){
	this.layout("HelpContainer");
	this.render("HelpPage", {
		data: function(){
			return HelpPages.findOne({urlstring: this.params.urlstring});
		}
	});
}, {
	name: "Helppages"
});

Router.route("/getting_started", {
	layoutTemplate: "GettingStartedLayout", 
	    yieldTemplates: {
	      'gsChecklist': {to: 'gs_checklist'},
	      'gsEdit': {to: 'gs_edit'},
			'gsHelp': {to: 'gs_help'}
	    }
});

Router.route("/users", function(){
	this.render("Users", {
		data: function() {
			return Meteor.users.find({});
		}
	});
})

Router.route("/welcome", function(){
	this.layout("GeneralLayout");
	this.render("Welcome", {
		data: function() {
			Meteor.users.update({_id: Meteor.userId()}, {$set: {"profile.showWelcome": false}});
			u.profile.showWelcome = false;
			return HelpPages.findOne({urlstring: "Welcome"});
		}
	})
})


