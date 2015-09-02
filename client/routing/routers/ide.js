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
		if ( !this.ready() ) {
			// console.log("WAITING: ", this)
			this.render("Loading", {
				data: "Dashboard"
			});
		} else {
			u = Meteor.user();
		
			if(u) {
				//show tutorials if first login.
				example = Meteor.settings.public.basicExampleApp
				console.log("FIRST Login test", u.profule, example)
				if(u.profile && u.profile.showExample && example) {
					this.redirect("/tutorials");
					//Session.setPersistent("currentAppId", example);
					Meteor.users.update({
						_id: Meteor.userId()
					}, {
						$set: {
							"profile.showExample": false
						}
					});
				}
			}
			if (u) {
				//Disable welcome page for the moment.
				//if (u.profile && u.profile.showWelcome) {
				if(false) {
					this.redirect("/welcome");
				} else {
					if ( !this.ready() ) {
						this.render("Loading", {
							data: "Dashboard"
						});
					} else {
						renderYields(this, 'Dashboard');
					}		
				}
			}
		}
	}

});

Router.route("/credentials", {
	name: "Credentials",
	controller: "IDEController",
	data: function() {
		return;
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "App"
			});
		} else {
			renderYields(this, 'Credentials');
		}		
	}
});

Router.route("/apps/:_id/", {
	name: "Edit App",
	controller: "IDEController",
	data: function() {
		return Apps.findOne({ _id: this.params._id });
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "App"
			});
		} else {
			renderYields(this, 'EditApp');
		}
	}
});

Router.route("/apps", {
	name: "Apps",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			// console.log("WAITING: ", this)
			this.render("Loading", {
				data: "Apps"
			});
		} else {
			renderYields(this, 'Apps');
		}
	}
});

Router.route("/connections/:_id", {
	name: "Edit Connection",
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

Router.route("/http_connections", {
	name: "HTTPConnections",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "HTTPConnections"
			});
		} else {
			renderYields(this, 'HTTPConnections');
		}
	}
});

Router.route("/http_connections/:_id", {
	name: "Edit HTTPConnection",
	controller: "IDEController",
	data: function() {
		return HTTPConnections.findOne({_id: this.params._id});
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "HTTPConnection"
			});
		} else {
			renderYields(this, 'EditSingleHTTPConnection');
		}
	}
});

Router.route("/feeds/:_id", {
	name: "Edit Feed",
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
			renderYields(this, 'EditFeed');
		}
	}
});

Router.route("/feeds", {
	name: "Feeds",
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
			renderYields(this, 'Feeds');
		}
	}
});

Router.route("/http_feeds", {
	name: "HTTPFeeds",
	controller: "IDEController",
	data: function() {
			return HTTPFeeds.find();
	},
	action: function(){
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "HTTPFeeds"
			});
		} else {
			renderYields(this, 'HTTPFeeds');
		}
	}
});

Router.route("/http_feeds/:_id", {
	name: "Edit HttpFeed",
	controller: "IDEController",
	data: function() {
		return HTTPFeeds.findOne({_id: this.params._id});
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Feed"
			});
		} else {
			renderYields(this, 'EditHttpFeed');
		}
	}
});

Router.route("/templates/:_id/edit", {
	name: "Edit Template",
	controller: "IDEController",
	data: function() {
		// if(isAdmin()) {
		// 	this.wait(Meteor.subscribe("singleScreen", this.params._id));
		// }
		if(!this.ready()){
			return {};
		}
		Session.set("currentScreenPage", this.params._id);
		scr = Screens.findOne({ _id: this.params._id });
		scr.safeEdit = false;
		// Set any default values up.
		widget = Widgets.findOne({baseScreen: this.params._id});
		//Set up dummy data for widgets.
		// if(widget && widget.parameters) {
		// 	for(var w = 0; w < widget.parameters.length; w++ ) {
		// 		p = widget.parameters[w];
		// 		//console.log("PARAM: ", p);
		// 		scr[p.title] = p.dummyValue;
		// 	}
		// }
		return scr;
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Template"
			});
		} else {
			renderYields(this, 'EditScreen');
		}
	}
});


Router.route("/templates/:_id/safeedit", {
	name: "Safe Edit Template",
	controller: "IDEController",
	data: function() {
		Session.set("currentScreenPage", this.params._id);
		scr =  Screens.findOne({ _id: this.params._id });
		scr.safeEdit = true;
		return scr;
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Template"
			});
		} else {
			renderYields(this, 'EditScreen');
		}
	}
});

Router.route("/templates/:_id", {
	name: "View Template",
	controller: "IDEController",
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

Router.route("/templates", {
	name: "Templates",
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



Router.route("/widgets/:_id/edit", {
	name: "Edit Widget",
	controller: "IDEController",
	data: function() {
		if(!this.ready()){
			return {};
		}
		// Session.set("currentScreenPage", this.params._id);
		scr = Widgets.findOne({ _id: this.params._id });
		return scr;
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Template"
			});
		} else {
			renderYields(this, 'EditWidget');
		}
	}
});

Router.route("/widgets/:_id", {
	name: "View Widget",
	controller: "IDEController",
	data: function() {
		if(!this.ready()){
			return {};
		}
		// Session.set("currentScreenPage", this.params._id);
		scr = Widgets.findOne({ _id: this.params._id });
		return scr;
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Template"
			});
		} else {
			renderYields(this, 'SingleWidget');
		}
	}
});

Router.route("/themes/:_id", {
	name: "Edit Theme",
	controller: "IDEController",
	data: function() {
		Session.set("currentTheme", this.params._id);
		return Themes.findOne({ _id: this.params._id });
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Theme"
			});
		} else {
			renderYields(this, 'EditTheme');
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
	data: function() {
		return Meteor.user();
	},
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


// Router.route("/olddocs/:urlstring", {
// 	name: "OldDocs",
// 	controller: "OldDocsController",
// 	data: function() {
// 		return HelpPages.findOne({ urlstring: this.params.urlstring });
// 	},
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Documenation"
// 			});
// 		} else {
// 			renderYields(this, "OldDocs");
// 		}
// 	}
// });

// Router.route("/docsold", {
// 	name: "OldDocumentation",
// 	controller: "OldDocsController",
// 	data: function() {
// 		return HelpPages.find({}, {
// 			sort: {
// 				pagenumber: 1
// 			}
// 		});
// 	},
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Documenation"
// 			});
// 		} else {
// 			renderYields(this, 'OldDocumentation');
// 		}
// 	},
// });


Router.route("/docs", {
	name: "Documentation",
	controller: "DocsController",
	data: function() {
		return DocsIndex;
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

Router.route("/docs/:urlstring", {
	name: "View Doc",
	controller: "DocsController",
	data: function() {
		return Docs.findOne({ "attributes.urlstring": this.params.urlstring });
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

Router.route("/chat", {
	name: "Chat",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Chat"
			});
		} else {
			renderYields(this, 'Chat')
		}	
	}
})

Router.route("/current-users", {
	name: "Current Users",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Current Users"
			});
		} else {
			renderYields(this, 'CurrentUsers')
		}	
	}
})

Router.route("/sysadmin", {
	name: "System Admin",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Sysadmin"
			});
		} else {
			renderYields(this, 'Sysadmin')
		}	
	}
})

Router.route("/inactives", {
	name: "Inactive Users",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Inactive Users"
			});
		} else {
			renderYields(this, 'InactiveUsers')
		}	
	}
})

Router.route("/debug", {
	name: "Debug",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Debug"
			});
		} else {
			renderYields(this, 'Debug')
		}	
	}
})