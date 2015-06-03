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
	controller: "IDEController",
	data: function() {
		return Apps.find({ _id: this.params._id });
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "App"
			});
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
			this.render("Loading", {
				data: "Apps"
			});
		} else {
			renderYields(this, 'Apps');
		}
	}
});

Router.route("/connections/:_id", {
	name: "EditSingleConnection",
	controller: "IDEController",
	data: function() {
		return Connections.findOne({_id: this.params._id});
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Connection"
			});
		} else {
			renderYields(this, 'EditSingleConnection');
		}
	}
});

Router.route("/connections", {
	name: "Connections",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Connections"
			});
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
			this.render("Loading", {
				data: "Feed"
			});
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
			this.render("Loading", {
				data: "Feeds"
			});
		} else {
			renderYields(this, 'DataFeeds');
		}
	}
});

Router.route("/screens/:_id/edit", {
	name: "EditSingleScreen",
	controller: "IDEController",
	data: function() {
		Session.set("currentScreenPage", this.params._id);
		return Screens.findOne({ _id: this.params._id });
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Template"
			});
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
			this.render("Loading", {
				data: "Template"
			});
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
			this.render("Loading", {
				data: "Templates"
			});
		} else {
			renderYields(this, 'Screens');
		}
	}
});

Router.route("/themes/:_id", {
	name: "SingleTheme",
	controller: "IDEController",
	data: function() {
		Session.set("currentTheme", this.params._id);
		return Themes.find({ _id: this.params._id });
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Theme"
			});
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
			this.render("Loading", {
				data: "Themes"
			});
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
			this.render("Loading", {
				data: "Widgets"
			});
		} else {
			renderYields(this, 'Widgets');
		}
	},
});

Router.route("/profile", {
	name: "Profile",
	controller: "ProfileController",
	data: function() {
		return Meteor.user();
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Profile"
			});
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
			this.render("Loading", {
				data: "Settings"
			});
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
			this.render("Loading", {
				data: "Tutorials"
			});
		} else {
			renderYields(this, 'Tutorials');
		}
	},
});

Router.route("/docs/:urlstring", {
	name: "Docs",
	controller: "DocsController",
	data: function() {
		return HelpPages.findOne({ urlstring: this.params.urlstring });
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Documenation"
			});
		} else {
			renderYields(this, "Docs");
		}
	}
});

Router.route("/docs", {
	name: "Documentation",
	controller: "DocsController",
	data: function() {
		return HelpPages.find({}, {
			sort: {
				pagenumber: 1
			}
		});
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Documenation"
			});
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
			this.render("Loading", {
				data: "Support"
			});
		} else {
			renderYields(this, 'Support');
		}
	},
});

Router.route("/people/:username", {
	name: "People",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Profile"
			});
		} else {
			renderYields(this, 'People');
		}	
	}
})
