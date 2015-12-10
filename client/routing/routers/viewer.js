Router.route("/app/:appid", {
	onBeforeAction: function() {
		Session.setPersistent("currentAppId", this.params.appid);
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
		// console.log("ACTION!")
		app = getCurrentApp();
		if(!app) {
			this.render("Loading", {
				data: "No such app or not shareable"
			});
			return;
		}
		screen_cnt = Screens.find({isWidget: false}).count();
		// If there is an app home page, go there
		if (app.home_page) {
			Router.go("/app/"+app._id+"/screen/" + app.home_page);
			// If there is only one screen, go to the one screen
		// } else if (screen_cnt == 1) {
		// 	scr = Screens.findOne({isWidget: false});
		// 	Router.go("/app/"+app._id+"/screen/" + scr._id);
		} else {
			this.render("ViewApp", {
				data: function() {
					return app;
				}
			})
		}
	}
});

Router.route("/app/:appid/screen/:_id", {
	controller: "AppViewerController",
	name: "ViewScreen",
	onBeforeAction: function(){
		Session.setPersistent("currentAppId", this.params.appid);
		this.next();
	},
	action: function() {
		if(!this.ready()) {
			this.render("Loading", {
				data: "Database subscriptions"
			});
			return;
		}
		app = getCurrentApp();
		// Have we come straight to this URL?
		if(!app) {
			//Yes, we need to set up the current app.
			// Cordova: Capable of starting with no app. We need to address this route.
			console.log("You are probably in Cordova: Pick an app.")
		}

		InstantiateWidgets();

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
