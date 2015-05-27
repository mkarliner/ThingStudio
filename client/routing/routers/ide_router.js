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

Router.route("/connections", {
	name: "Connections",
	controller: "IDEController",
	action: function() {
		renderYields(this, Router.current().route.getName());
	}
});

Router.route("/apps", {
	name: "Apps",
	controller: "IDEController",
	action: function() {
		renderYields(this, Router.current().route.getName());
	}
});

Router.route("/screens", {
	name: "Screens",
	controller: "IDEController",
	action: function() {
		renderYields(this, Router.current().route.getName());
	}
});

Router.route("/themes", {
	name: "Themes",
	controller: "IDEController",
	action: function() {
		renderYields(this, Router.current().route.getName());
	}
});

Router.route("/feeds", {
	name: "DataFeeds",
	controller: "IDEController",
	action: function() {
		renderYields(this, Router.current().route.getName());
	}
});

Router.route("/feeds/:_id", {
	name: "View Feed",
	controller: "IDEController",
	action: "action",
	where: "client"
});

Router.route("/widgets", {
	name: "Widgets",
	controller: "IDEController",
	action: function() {
		renderYields(this, Router.current().route.getName());
	}
});

Router.route("/tutorials", {
	name: "Tutorials",
	controller: "IDEController",
	action: function() {
		renderYields(this, Router.current().route.getName());
	}
});

Router.route("/docs", {
	name: "Documentation",
	controller: "IDEController",
	action: function() {
		renderYields(this, Router.current().route.getName());
	}
});

Router.route("/support", {
	name: "Support",
	controller: "IDEController",
	action: function() {
		renderYields(this, Router.current().route.getName());
	}
});