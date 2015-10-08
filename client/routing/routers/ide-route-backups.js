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
