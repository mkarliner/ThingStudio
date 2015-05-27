

Router.route("/view/app/:_id", {
	onBeforeAction: function(){
		console.log("OBA")
		Session.set("currentAppId", this.params._id);
		this.next();
	},
	controller: "AppViewerController",
	name: "ViewApp",
	action: function() {
		console.log("ACTION!")
		app = getCurrentApp();
		connection = Connections.findOne({_id: app.connection});
		
		// Connect if we found a connection, otherwise disconnect
		// We may be jumping from the IDE to the Viewer, etc.
		// This will also subscribe to all feeds associated with the connection
		// See 'connect' for details
		if (connection) {
			connect(connection)
		} else {
			disconnect();
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
	name: "ViewScreen",
	action: function(){
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