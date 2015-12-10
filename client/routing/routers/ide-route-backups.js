// Backups of old routes

// Router.route("/mqtt-feed", {
// 	name: "MQTT Feeds",
// 	controller: "IDEController",
// 	data: function() {
// 			return Feeds.find();
// 	},
// 	action: function(){
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Feeds"
// 			});
// 		} else {
// 			renderYields(this, 'Feeds');
// 		}
// 	}
// });

// Router.route("/http-feed", {
// 	name: "HTTP Feeds",
// 	controller: "IDEController",
// 	data: function() {
// 			return HTTPFeeds.find();
// 	},
// 	action: function(){
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "HTTP Feeds"
// 			});
// 		} else {
// 			renderYields(this, 'HTTPFeeds');
// 		}
// 	}
// });

// Router.route("/olddocs/:urlstring", {
// 	name: "OldDocs",
// 	controller: "IDEController",
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
// 	controller: "IDEController",
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

// Router.route("/mqtt-connections", {
// 	name: "MQTT Connections",
// 	controller: "IDEController",
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Connections"
// 			});
// 		} else {
// 			renderYields(this, 'Connections');
// 		}
// 	}
// });

// Router.route("/http-connections", {
// 	name: "HTTP Connections",
// 	controller: "IDEController",
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "HTTP Connections"
// 			});
// 		} else {
// 			renderYields(this, 'HTTPConnections');
// 		}
// 	}
// });

// Router.route("/templates/:_id", {
// 	name: "View Template",
// 	controller: "IDEController",
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Template"
// 			});
// 		} else {
// 			renderYields(this, 'SingleScreen');
// 		}
// 	}
// });

// Router.route("/people/:username", {
// 	name: "People",
// 	controller: "IDEController",
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Profile"
// 			});
// 		} else {
// 			renderYields(this, 'People');
// 		}
// 	}
// })

// Router.route("/templates/:_id/safeedit", {
// 	name: "Safe Edit Template",
// 	controller: "IDEController",
// 	data: function() {
// 		Session.set("currentScreenPage", this.params._id);
// 		scr =  Screens.findOne({ _id: this.params._id });
// 		scr.safeEdit = true;
// 		return scr;
// 	},
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Template"
// 			});
// 		} else {
// 			renderYields(this, 'EditScreen');
// 		}
// 	}
// });

// Router.route("/themes/:_id", {
// 	name: "Edit Theme",
// 	controller: "IDEController",
// 	data: function() {
// 		Session.set("currentTheme", this.params._id);
// 		return Themes.findOne({ _id: this.params._id });
// 	},
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Theme"
// 			});
// 		} else {
// 			renderYields(this, 'EditTheme');
// 		}
// 	}
// });
//
// Router.route("/themes", {
// 	name: "Themes",
// 	controller: "IDEController",
// 	action: function() {
// 		if ( !this.ready() ) {
// 			this.render("Loading", {
// 				data: "Themes"
// 			});
// 		} else {
// 			renderYields(this, 'Themes');
// 		}
// 	}
// });

// Router.route("/dashboard", {
// 	name: "Dashboard",
// 	controller: "IDEController",
// 	action: function() {
// 		if ( !this.ready() ) {
// 			// console.log("WAITING: ", this)
// 			this.render("Loading", {
// 				data: "Dashboard"
// 			});
// 		} else {
// 			u = Meteor.user();
// 			if (u) {
// 				//Disable welcome page for the moment.
// 				if (u.profile && u.profile.showWelcome) {
// 					this.redirect("/welcome");
// 				} else {
// 					if ( !this.ready() ) {
// 						this.render("Loading", {
// 							data: "Dashboard"
// 						});
// 					} else {
// 						renderYields(this, 'Dashboard');
// 					}
// 				}
// 			}
// 		}
// 	}
//
// });
