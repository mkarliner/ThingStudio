Template.AppTopNav.onRendered(function() {
	$(".dropdown-button").dropdown();
	$('.tooltipped').tooltip({delay: 400});
});

Template.AppTopNav.events({
	'click .debug-dropdown': function(e, tmpl) {
		e.preventDefault();
		debugOps();

		// $(document).on('click', function(event) {
		// 	if (!$(event.target).closest('.debug').length) {
		// 		$('.debug').hide();
		// 	}
		// });
	},
	'click .hide-header': function() {
		headerVisibility();
		// $(window).on('resize', function () {
		//     resizeAce();
		// });
		resizeAce();
	}
});

Template.AppTopNav.helpers({
	currentConnectionName: function() {
		app = getCurrentConnection();
		if (app) {
			return app.title;
		} else {
			return 'No connection. Have you set a connection in your App settings?';
		}
	},
	isConnected: function() {
		if ( Session.get( "ConnectionStatus" ) == true ) {
			return 'connected';
		} else {
			return 'disconnected';
		}
	}
});

Template.BreadcrumbsContent.helpers({
	route_base: function() {
		// This function sets the base of the breadcrumb
		var routeName = Router.current().route.getName();
		var routePath = Router.current().route.path();
		var routes = [ "Connections", "Feeds", "Templates", "Themes", "Edit Feed", "Edit Connection", "Edit Template", "Edit Theme" ];
		
		if ( routeName == "Dashboard" ){
			// Display of home route is handled in template
			// Applies to: Dashboard
			return false;
		} else if ( _.contains( routes, routeName ) ) {
			// If current route is a 'sub-route' of the app, then return the current app as the base of the breadcrumb
			// Applies to: sub-app list pages, edit pages
			var appTreeObj = Session.get("appTreeList")
			appTreeObj[0].path = "/apps/" + appTreeObj[0]._id;
			return appTreeObj;
		} else if ( routeName == "Docs" ) {
			// Applies to: Single documentation pages
			return [ { path: '/docs', title: "Documentation" } ];
		} else {
			// Applies to: Widgets list, Apps list, Documenation, Support, Settings
			var routeObj = {_id: routePath, title: routeName};
			return [routeObj];
		}
	},
	route_extension: function() {
		// This function provides details of the route, not including the base, which is handled above
		var routeName = Router.current().route.getName();
		var routePath = Router.current().route.path();
		var displayRoutes = [ "Connections", "Feeds", "Templates", "Themes" ];
		var nonDisplayRoutes = [ "Support", "Widgets", "Apps", "Dashboard" ]
		
		if ( _.contains( nonDisplayRoutes, routeName ) ) {
			// Applies to: Dashboard, Apps list, Widgets list, Support
			return false;
		} else if ( _.contains( displayRoutes, routeName ) ) {
			// Applies to: sub-app list pages
			return [ { item: routeName, path: routePath } ];
		} else if ( routeName == "Docs" ) {
			// Applies to: Single documentation pages
			return [ { item: this.title, path: this._id } ];
		} else if ( routeName == "Edit Feed" ) {
			// Applies to: edit feed page
			return [ { item: "Feeds", path: "/feeds" }, { item: this.title, path: "/feeds/" + this._id } ];
		} else if ( routeName == "Edit Connection" ) {
			// Applies to: edit connection page
			return [ { item: "Connections", path: "/connections" }, { item: this.title, path: "/connections/" + this._id } ];
		} else if ( routeName == "Edit Template" ) {
			// Applies to: edit connection page
			return [ { item: "Templates", path: "/templates" }, { item: this.title, path: "/templates/" + this._id } ];
		} else if ( routeName == "Edit Theme" ) {
			// Applies to: edit connection page
			return [ { item: "Themes", path: "/themes" }, { item: this.title, path: "/themes/" + this._id } ];
		} else {
			console.log("from breadcrumb, should not run");
			return [{ item: "None", path: "/none" }, { item: "none", path: "/none/" + 2324 }]
		}
	}
});