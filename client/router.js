Router.configure({
	layoutTemplate: function() {
		return 'GeneralLayout';
	}
});

AccountsTemplates.configureRoute('signIn');

// Accounts.onLogin(function(){
// 	Router.go("/screens");
// })


Router.onBeforeAction(function(par) {
	// console.log("Before action", par);
	if (!Meteor.user() && !Meteor.loggingIn()) {
		this.layout("HelpLayout");
		this.render("Login");
	} else {
		this.next();
	}
}, { except: [ "Help", "Helppages", "ViewScreen", "ViewApp"]});




Router.route("/", function() {
	u = Meteor.user();
	if (u) {
		if (u.profile && u.profile.showWelcome) {
			this.redirect("/welcome");
		} else {
			this.redirect("Screens");
		}
	} else {
		this.layout('HomeLayout');
		this.render("Home");
	}
}, {
	name: "Root"
});




Router.route("/logout", function(){
	AccountsTemplates.logout();
})



Router.route("/view/app/:_id", {
	//To render a app, show the home page if it has one,
	// if this is only one screen, show that.
	// otherwise show a menu of screens.
	onBeforeAction: function(){
		console.log("BA!!!!")
		Session.set("currentAppId", this.params._id);
		this.next();
	},
	// waitOn: function() {
	// 	console.log("Waiting for ", this.params._id);
	// 	Session.set("currentAppId", this.params._id);
	// 	Session.setPersistent("currentApp", {_id: this.params._id});
	// 	return [Meteor.subscribe("apps", this.params._id), Meteor.subscribe("screens", this.params._id)];
	// },
	loadingTemplate: "Loading",

	data: function() {
		this.layout("ViewerLayout");
		app = Apps.findOne({
			_id: this.params._id
		});
		if(!app) {
			return;
		}

		// Is there a connection specified for this app?
		if(app.connection) {
			conn = Connections.findOne(app.connection)
			// Is the connection available yet?
			if(!conn) {
				console.log("CONNECTION NOT READY!!!")
				return;
			}
			// Do I need to client authenticate?
			if(conn.userAuth && conn.userAuth == true &&  Session.get("authReady") != true) {
				console.log("NEED AUTH")
				cred = Credentials.findOne({connection: conn._id});
				if(cred) {	
					console.log("CRED: ", cred)
				} else {
					cid = Credentials.upsert( {connection: conn._id}, {$set: {connection: conn._id, username: "dfa", password: "sadf", save: false}});
					console.log("Creating credentials record")
					cred = Credentials.findOne({connection: conn._id});
				}
				this.render("GetCredentials", {
						data: function() {
							console.log("CREDENTIALS: ", cred);
							return cred;
						}
					});
					return;
			} else {
				console.log("AUTH OK", conn)
			}
			
		}

		Session.set("currentApp", app);
		screen_cnt = Screens.find().count();
		InstantiateScreens();
		if (app.home_page) {
			Router.go("/viewer/screen/" + app.home_page);
		} else if (screen_cnt == 1) {
			scr = Screens.findOne({});
			console.log("scr", scr);
			Router.go("/viewer/screen/" + scr._id);
		} else {
			this.render("ViewApp", {
				data: function() {
					return app;
				}
			})
		}
	},
	name: "ViewApp"
});


Router.route("/viewermenu", function() {
	this.layout('ViewerLayout');
	this.render("ViewerMenu");
});

Router.route("/viewer/screen/:_id", function() {
	this.layout('ViewerLayout');
	this.render("ViewScreen", {
		data: function() {
			Session.set("currentScreenPage", this.params._id);
			return Screens.findOne({
				_id: this.params._id
			});
		}
	});
}, {
	name: "ViewScreen"
});


Router.route("/connections", function() {
	this.render("Connections");
}, {
	name: "Connections"
});

Router.route("/connectionold", function() {
	this.layout("GeneralLayout");
	this.wait(Meteor.subscribe("connections", Session.get("currentApp")._id));
	if (this.ready()) {
		this.render("Connection", {
			data: function() {
				console.log("CONN", Connections.findOne());
				conn = Connections.findOne();
				if (conn) {
					return conn;
				}
			}
		})
	}

});

Router.route("screens/:_id/edit", function(){
	this.layout("GeneralLayout");
	this.render("EditScreen", {
		data: function(){
			if(!this.ready()) {
				console.log("Not ready")
				return;
			}
			Session.set("currentScreenPage", this.params._id);
			return Screens.findOne({_id: this.params._id});
		}
	});
});

Router.route("/screens/:_id", function() {
	this.layout("GeneralLayout");
	this.render("Screen", {
		data: function() {
			Session.set("currentScreenPage", this.params._id);
			return Screens.findOne({
				_id: this.params._id
			});
		}
	});
}, {
	name: "Screen"
});


Router.route("/apps/:_id/share", function() {
	this.layout("GeneralLayout");
	this.render("ShareApp", {
		data: function() {
			return Apps.findOne({
				_id: this.params._id
			});
		}
	});
});

Router.route("/apps", function() {
	this.layout("GeneralLayout");
	this.render("Apps");
}, {
	name: "Apps"
});


Router.route("/screens", function() {
	this.layout("GeneralLayout");
	this.render("Screens");
}, {
	name: "Screens"
});

Router.route("/themes/:_id", function() {
	this.render("Theme", {
		data: function() {
			Session.set("currentTheme", this.params._id);
			return Themes.findOne({
				_id: this.params._id
			});
		}
	});
});

Router.route("/themes", function() {
	this.render("Themes");
});

Router.route("/feeds", function() {
	this.render("Feeds");
});

Router.route("/docs/about", function() {
	this.layout("HelpLayout");
	this.render("HelpAbout");
});

Router.route("/profile", function() {
	this.render("Profile", {
		data: function() {
			return Meteor.user();
		}
	});
}, {
	name: "Profile"
});

Router.route("/debug", function() {
	this.render("Debug");
});

Router.route("/docs", function() {
	this.layout("HelpContainer");
	this.render("HelpMenu");

}, {
	name: "Docs"
});

Router.route("/docs/:urlstring", function() {
	this.layout("HelpContainer");
	this.render("HelpPage", {
		data: function() {
			return HelpPages.findOne({
				urlstring: this.params.urlstring
			});
		}
	});
}, {
	name: "Helppages"
});

Router.route("/getting_started", {
	layoutTemplate: "GettingStartedLayout",
	yieldTemplates: {
		'gsChecklist': {
			to: 'gs_checklist'
		},
		'gsEdit': {
			to: 'gs_edit'
		},
		'gsHelp': {
			to: 'gs_help'
		}
	}
});

Router.route("/users", function() {
	this.render("Users", {
		data: function() {
			return Meteor.users.find({});
		}
	});
})

Router.route("/welcome", function() {
	this.layout("GeneralLayout");
	this.render("Welcome", {
		data: function() {
			Meteor.users.update({
				_id: Meteor.userId()
			}, {
				$set: {
					"profile.showWelcome": false
				}
			});
			return HelpPages.findOne({
				urlstring: "Welcome"
			});
		}
	})
})
