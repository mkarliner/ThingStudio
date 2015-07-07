// Router.route("/debug", function() {
// 	this.render("debugNew");
// });



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
	this.layout("MasterLayout");
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

// Router.route("/connections", function() {
// 	this.layout("MasterLayout");
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("ConnectionsHeader", {
// 		to: "appHeader"
// 	});
// 	this.render("ConnectionsBody");
// }, {
// 	name: "Connections"
// });

// Router.route("/connectionold", function() {
// 	this.layout("GeneralLayout");
// 	this.wait(Meteor.subscribe("connections", Session.get("currentApp")._id));
// 	if (this.ready()) {
// 		this.render("Connection", {
// 			data: function() {
// 				console.log("CONN", Connections.findOne());
// 				conn = Connections.findOne();
// 				if (conn) {
// 					return conn;
// 				}
// 			}
// 		})
// 	}

// });

// Router.route("/apps", function() {
// 	//this.layout("GeneralLayout");
// 	this.layout("MasterLayout");
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("AppsHeader", {
// 		to: "appHeader"
// 	});
// 	this.render("AppsBody");
// }, {
// 	name: "Apps"
// });

// Router.route("/screens", function() {
// 	this.layout("MasterLayout");
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("TemplatesHeader", {
// 		to: "appHeader"
// 	});
// 	this.render("TemplatesBody");
// }, {
// 	name: "Templates"
// });

// Router.route("/themes", function() {
// 	this.layout("MasterLayout");
// 	this.render("Themes");
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("ThemesHeader", {
// 		to: "appHeader"
// 	});
// 	this.render("ThemesBody")
// }, {
// 	name: "Themes"
// });

// Router.route("/feeds", function() {
// 	this.layout("MasterLayout");
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("FeedsHeader", {
// 		to: "appHeader"
// 	});
// 	this.render("FeedsBody");
// }, {
// 	name: "Data Feeds"
// });

// Router.route("/feeds/:_id", {
// 	name: "View Feed",
// 	controller: "FeedController",
// 	action: "action",
// 	where: "client"
// });

// Router.route("/widgets", function() {
// 	this.layout("MasterLayout");
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("WidgetsHeader", {
// 		to: "appHeader"
// 	});
// 	this.render("WidgetsBody");
// }, {
// 	name: "Widgets"
// });

// Router.route("/docs/about", function() {
// 	this.layout("HelpLayout");
// 	this.render("HelpAbout");
// });

// Router.route("/support", function() {
// 	this.layout("MasterLayout");
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("SupportHeader", {
// 		to: "appHeader"
// 	})
// 	this.render("SupportBody");
// }, {
// 	name: "Support"
// });

// Router.route("/docs", function() {
// 	this.layout("MasterLayout");
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("DocumentationListHeader", {
// 		to: "appHeader"
// 	})
// 	this.render("DocumentationListBody");
// }, {
// 	name: "Documentation"
// });

// Router.route("/tutorials", function() {
// 	this.layout("MasterLayout");
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("TutorialsHeader", {
// 		to: "appHeader"
// 	})
// 	this.render("TutorialsBody");
// }, {
// 	name: "Tutorials"
// });

// Router.route("/profile", function() {
// 	this.layout("MasterLayout", {
// 		data: function() {
// 			return Meteor.user();
// 		}
// 	});
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("ProfileHeader", {
// 		to: "appHeader"
// 	})
// 	this.render("ProfileBody");
// }, {
// 	name: "Profile"
// });

// Router.route("/settings", function() {
// 	this.layout("MasterLayout", {
// 		data: function() {
// 			return Meteor.user();
// 		}
// 	});
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("SettingsHeader", {
// 		to: "appHeader"
// 	})
// 	this.render("SettingsBody");
// }, {
// 	name: "Settings"
// });

// Router.route("/docs/:urlstring", function() {
// 	this.layout("MasterLayout", {
// 		data: function() {
// 			return HelpPages.findOne({
// 				urlstring: this.params.urlstring
// 			});
// 		}
// 	});
// 	this.render('BreadcrumbsContent', {
// 		to: 'breadcrumbs'
// 	});
// 	this.render("HelpPage");
// }, {
// 	name: "Docs"
// });

// Router.route("screens/:_id/edit", function(){
// 	this.layout("GeneralLayout");
// 	this.render("EditScreen", {
// 		data: function(){
// 			if(!this.ready()) {
// 				console.log("Not ready")
// 				return;
// 			}
// 			Session.set("currentScreenPage", this.params._id);
// 			return Screens.findOne({_id: this.params._id});
// 		}
// 	});
// });

// Router.route("/screens/:_id", function() {
// 	this.layout("GeneralLayout");
// 	this.render("Screen", {
// 		data: function() {
// 			Session.set("currentScreenPage", this.params._id);
// 			return Screens.findOne({ _id: this.params._id});
// 		}
// 	});
// });

// Router.route("/apps/:_id/share", function() {
// 	this.layout("GeneralLayout");
// 	this.render("ShareApp", {
// 		data: function() {
// 			return Apps.findOne({
// 				_id: this.params._id
// 			});
// 		}
// 	});
// });

// Router.route("/themes/:_id", function() {
// 	this.layout("GeneralLayout");
// 	this.render("Theme", {
// 		data: function() {
// 			Session.set("currentTheme", this.params._id);
// 			return Themes.findOne({
// 				_id: this.params._id
// 			});
// 		}
// 	});
// });
