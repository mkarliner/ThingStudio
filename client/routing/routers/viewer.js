Router.route("/view/app/:_id", {
	onBeforeAction: function() {
		Session.setPersistent("currentAppId", this.params._id);
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
	onBeforeAction: function(){
		Session.set("currentScreenId", this.params._id);
		this.next();
	},

	action: function() {
		if(!this.ready()) {
			console.log("SUB NOT READY")
			this.render("Loading", {
				data: "Database subscriptions"
			});
			return;
		}
		app = getCurrentApp();
		// Have we come straight to this URL?
		if(!app) {
			//Yes, we need to set up the current app.
			scr = Screens.findOne({_id: this.params._id});
			Session.setPersistent("currentAppId", scr.appId);
			this.render("Loading",{
				data: "Application sub"
			})		
		}
		InstantiateScreens();
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
