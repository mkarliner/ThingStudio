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

