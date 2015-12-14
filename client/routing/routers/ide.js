var renderYields = function(that, t,  data) {
	that.render('BreadcrumbsContent', {
		to: 'breadcrumbs'
	});
	that.render(t + "Header", {
		to: "appHeader"
	});
	that.render(t + "Body", {data: data});
}

Router.route("/welcome", {
	name: "Welcome",
	controller: "IDEController",
	data: function() {
		Meteor.users.update({
			_id: Meteor.userId()
		}, {
			$set: {
				"profile.showWelcome": false
			}
		});
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "Welcome Video"
			});
		} else {
			renderYields(this, 'Welcome')
		}
	}
})


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

Router.route("/apps/new", {
	name: "New App",
	controller: "IDEController",
	action: function() {
		renderYields(this, 'NewApp');
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
			this.render("Loading", {
				data: "Apps"
			});
		} else {
			u = Meteor.user();
			if (u) {
				//Disable welcome page for the moment.
				if (u.profile && u.profile.showWelcome) {
					this.redirect("/welcome");
				} else {
					if ( !this.ready() ) {
						this.render("Loading", {
							data: "Apps"
						});
					} else {
						renderYields(this, 'Apps');
					}
				}
			}
		}

	}
});

Router.route("/mqtt-connection/new", {
	name: "New MQTT Connection",
	controller: "IDEController",
	action: function() {
		renderYields(this, 'NewMqttConnection');
	}
});


Router.route("/mqtt-connection/:_id", {
	name: "Edit MQTT Connection",
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
			renderYields(this, 'EditMqttConnection');
		}
	}
});

Router.route("/http-connection/new", {
	name: "New HTTP Connection",
	controller: "IDEController",
	action: function() {
		renderYields(this, 'NewHttpConnection');
	}
});

Router.route("/http-connection/:_id", {
	name: "Edit HTTP Connection",
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
			renderYields(this, 'EditHttpConnection');
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

Router.route("/mqtt-feed/new", {
	name: "New MQTT Feed",
	controller: "IDEController",
	action: function() {
		renderYields(this, 'NewMqttFeed');
	}
});

Router.route("/mqtt-feed/:_id", {
	name: "Edit MQTT Feed",
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
			renderYields(this, 'EditMqttFeed');
		}
	}
});

Router.route("/http-feed/new", {
	name: "New HTTP Feed",
	controller: "IDEController",
	action: function() {
		renderYields(this, 'NewHttpFeed');
	}
});

Router.route("/http-feed/:_id", {
	name: "Edit HTTP Feed",
	controller: "IDEController",
	data: function() {
		return HTTPFeeds.findOne({_id: this.params._id});
	},
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "HTTP Feed"
			});
		} else {
			renderYields(this, 'EditHttpFeed');
		}
	}
});

Router.route("/feeds", {
	name: "Feeds",
	controller: "IDEController",
	data: function() {
			return {
				mqttFeeds: Feeds.find(),
				httpFeeds: HTTPFeeds.find()
			}
	},
	action: function(){
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "All Feeds"
			});
		} else {
			renderYields(this, 'Feeds');
		}
	}
});

Router.route("/templates/new", {
	name: "New Template",
	controller: "IDEController",
	action: function() {
		renderYields(this, 'NewScreen');
	}
});

Router.route("/templates/:_id/edit", {
	name: "Edit Template",
	controller: "IDEController",
	data: function() {
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

Router.route("/widgets/new", {
	name: "New Widget",
	controller: "IDEController",
	action: function() {
		renderYields(this, 'NewWidget');
	}
});

Router.route("/widgets/:_id/edit", {
	name: "Edit Widget",
	controller: "IDEController",
	data: function() {
		if(!this.ready()){
			return {};
		}
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

Router.route("/tutorials/:urlstring", {
	name: "Tutorial Item",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "your tutorias"
			});
		} else {
			renderYields(this, 'Tutorial');
		}
	},
});

Router.route("/docs/:urlstring", {
	name: "View Doc",
	controller: "IDEController",
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

Router.route("/docs", {
	name: "Documentation",
	controller: "IDEController",
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

Router.route("/view-user/:id", {
	name: "ViewUser",
	controller: "IDEController",
	action: function() {
		if ( !this.ready() ) {
			this.render("Loading", {
				data: "User"
			});
		} else {
			renderYields(this, 'ViewUser', this.params.id)
		}
	}
})


// Router.route("/inactives", {
// 	name: "Inactive Users",
// 	controller: "IDEController",
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Inactive Users"
// 			});
// 		} else {
// 			renderYields(this, 'InactiveUsers')
// 		}
// 	}
// })

// Router.route("/debug", {
// 	name: "Debug",
// 	controller: "IDEController",
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Debug"
// 			});
// 		} else {
// 			renderYields(this, 'Debug')
// 		}
// 	}
// });

Router.route("/reset-password/:token", {
	name:  "ResetPassword",
	controller: "IDEController",
	action: function() {
		Session.set('resetPassword', this.params.token);
		renderYields(this, "ResetPassword");
	}
})
