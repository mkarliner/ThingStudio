var renderYields = function(that, t) {
	that.render('BreadcrumbsContent', {
		to: 'breadcrumbs'
	});
	that.render(t + "Header", {
		to: "appHeader"
	});
	that.render(t + "Body");
}

Router.route("/dashboard", {
	name: "Dashboard",
	controller: "IDEController",
	action: function() {
		u = Meteor.user();
		console.log("ACT ", u)
		if (u) {
			if (u.profile && u.profile.showWelcome) {
				this.redirect("/welcome");
			} else {
				this.render("DashboardBody");
			}
		}
	}
});

Router.route("/apps/:_id/", {
	name: "EditSingleApp",
	controller: "SingleAppController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'EditSingleApp');
		}
	}
});

Router.route("/apps", {
	name: "Apps",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Apps');
		}
	}
});

Router.route("/connections", {
	name: "Connections",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Connections');
		}
	}
});

Router.route("/feeds/:_id", {
	name: "View Feed",
	controller: "IDEController",
	data: function() {
		return Feeds.findOne({_id: this.params._id});
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'ViewFeed');
		}
	}
});

Router.route("/feeds", {
	name: "Data Feeds",
	controller: "IDEController",
	data: function() {
			return Feeds.find();
	},
	action: function(){
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'DataFeeds');
		}
	}
});

Router.route("/screens/:_id/edit", {
	name: "EditSingleScreen",
	controller: "SingleScreenController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'EditSingleScreen');
		}
	}
});

Router.route("/screens/:_id", {
	name: "SingleScreen",
	controller: "SingleScreenController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'SingleScreen');
		}
	}
});

Router.route("/screens", {
	name: "Screens",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Screens');
		}
	}
});

Router.route("/themes/:_id", {
	name: "SingleTheme",
	controller: "SingleThemeController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'SingleTheme');
		}
	}
});

Router.route("/themes", {
	name: "Themes",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Themes');
		}
	}
});

Router.route("/widgets", {
	name: "Widgets",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Widgets');
		}
	},
});

Router.route("/profile", {
	name: "Profile",
	controller: "ProfileController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Profile');
		}
	}
});

Router.route("/settings", {
	name: "Settings",
	controller: "ProfileController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Settings');
		}
	}
});

Router.route("/tutorials", {
	name: "Tutorials",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Tutorials');
		}
	},
});

Router.route("/docs/:urlstring", {
	name: "Docs",
	controller: "SingleDocController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, "Docs");
		}
	}
});

Router.route("/docs", {
	name: "Documentation",
	controller: "DocsController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Documentation');
		}
	},
});

Router.route("/support", {
	name: "Support",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("LoadingIDE");
		} else {
			renderYields(this, 'Support');
		}
	},
});