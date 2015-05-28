Router.route("/view/app/:_id", {
	onBeforeAction: function() {
		console.log("OBA")
		Session.set("currentAppId", this.params._id);
		this.next();
	},
	controller: "AppViewerController",
	name: "ViewApp",
	action: function() {
		if(!this.ready()) {
			console.log("SUB NOT READY")
			this.render("Loading", {
				data: "Database subscriptions"
			});
			return;
		}
		console.log("ACTION!")
		app = getCurrentApp();
		console.log("Current APP", app)
		// if(!app) {
		// 	this.render("Loading", {
		// 		data: "Current Application"
		// 	});
		// 	return;
		// }
		connection = Connections.findOne({
			// _id: app.connection
		});
		console.log("VIEWCONN ", app.connection, connection)
		// Connect if we found a connection, otherwise disconnect
		// We may be jumping from the IDE to the Viewer, etc.
		// This will also subscribe to all feeds associated with the connection
		// See 'connect' for details
		// if (connection) {
		// 	connect(connection)
		// } else {
		// 	disconnect();
		// }
		


		// Do I need to the user to provide authentication credentials?
		if ((!connection.serverCredentials || connection.serverCredentials == false) && Session.get("authReady") != true) {
			console.log("NEED AUTH")
			if (!Ground.ready()) {
				console.log("GROUND NOT READY")
				this.render("Loading", {
					data: "Authentication database"
				});
				return;
			}
			console.log("GROUND  READY")
			cred = Credentials.findOne({
				connection: connection._id
			});
			if (cred) {
				console.log("FOUND CRED: ", cred)
			} else {
				cid = Credentials.upsert({
					connection: connection._id
				}, {
					$set: {
						connection: connection._id,
						username: "dfa",
						password: "sadf",
						save: false
					}
				});
				console.log("Creating credentials record")
				cred = Credentials.findOne({
					connection: connection._id
				});
			}

			this.render("GetCredentials", {
				data: function() {
					console.log("CREDENTIALS: ", cred);
					return cred;
				}
			});
			return;
		} else {
			console.log("AUTH OK", connection)
		}


		screen_cnt = Screens.find().count();
		InstantiateScreens();
		// If there is an app home page, go there
		if (app.home_page) {
			Router.go("/viewer/screen/" + app.home_page);
			// If there is only one screen, go to the one screen
		} else if (screen_cnt == 1) {
			scr = Screens.findOne({});
			Router.go("/viewer/screen/" + scr._id);
		} else {
			this.render("ViewApp", {
				data: function() {
					return app;
				}
			})
		}
	}
});




Router.route("/viewer/screen/:_id", {
	controller: "AppViewerController",
	name: "ViewScreen",
	action: function() {
		this.render("ViewScreen", {
			data: function() {
				Session.set("currentScreenPage", this.params._id);
				return Screens.findOne({
					_id: this.params._id
				});
			}
		});

	}

});
