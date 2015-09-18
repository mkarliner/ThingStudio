Template.AppTopNav.onRendered(function() {
	$('.tooltipped').tooltip({delay: 400});
});

Template.AppTopNav.events({
	'click .debug-dropdown': function(e, tmpl) {
		e.preventDefault();
		debugOps();
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
		var appPrefixRoutes = [ "Connections", "Feeds", "Templates", "Themes", "Edit Feed", "Edit Connection", "Edit Template", "Safe Edit Template", "Edit Theme" ];
		var nonDisplayRoutes = [ "Dashboard", "View Widget", "Edit App", "View Doc" ];
		if ( _.contains( nonDisplayRoutes, routeName ) ) {
			// Applies to: Dashboard, View Widget, Edit App
			return false;
		} else if ( _.contains( appPrefixRoutes, routeName ) ) {
			// If current route is a 'sub-route' of the app, then return the current app as the base of the breadcrumb
			// Applies to: sub-app list pages, edit pages
			var appTreeObj = Session.get("appTreeList")
			appTreeObj[0].path = "/apps/" + appTreeObj[0]._id;
			return appTreeObj;
		} else if ( routeName == "View Doc" ) {
			// Applies to: Single documentation pages
			return [ { path: '/docs', title: "Documentation" } ];
		} else {
			// Applies to: Widgets list, Apps list, Documenation, Support, Settings, Chat, Current Users, Sys admin
			var routeObj = {_id: routePath, title: routeName};
			return [routeObj];
		}
	},
	route_extension: function() {
		// This function provides details of the route, not including the base, which is handled above
		var routeName = Router.current().route.getName();
		var routePath = Router.current().route.path();
		var displayRoutes = [ "Connections", "Feeds", "Templates", "Themes" ];
		var nonDisplayRoutes = [ "Support", "Widgets", "Apps", "Dashboard", "Chat", "Current Users", "System Admin", "Settings", "Documentation", "Debug", "Tutorials" ];

		if ( _.contains( nonDisplayRoutes, routeName ) ) {
			// Applies to: Dashboard, Apps list, Widgets list, Support, Chat, Current Users, System Admin, Settings, Documentation
			return false;
		} else if ( _.contains( displayRoutes, routeName ) ) {
			// Applies to: sub-app list pages
			return [ { item: routeName, path: routePath } ];
		} else if ( routeName == "View Doc" ) {
			// Applies to: Single documentation pages
			// return [ { item: this.title, path: this._id } ];
			return [ { item: "Documentation", path: "/docs" }, { item: this.attributes.title, path: "/docs/" + this.attributes.urlstring} ];
		} else if ( routeName == "Edit Feed" ) {
			// Applies to: edit feed page
			return [ { item: "Feeds", path: "/feeds" }, { item: this.title, path: "/feeds/" + this._id } ];
		} else if ( routeName == "Edit Connection" ) {
			// Applies to: edit connection page
			return [ { item: "Connections", path: "/connections" }, { item: this.title, path: "/connections/" + this._id } ];
		} else if ( routeName == "Edit Template" ) {
			// Applies to: edit template page
			return [ { item: "Templates", path: "/templates" }, { item: this.title, path: "/templates/" + this._id + "/edit"} ];
		} else if ( routeName == "Safe Edit Template" ) {
			// Applies to: safe edit template page
			return [ { item: "Templates", path: "/templates" }, { item: this.title + " (Safe Edit)", path: "/templates/" + this._id + "/safeedit"} ];
		} else if ( routeName == "Edit Widget" ) {
			// Applies to: edit widget page, which at the moment (0.2.0), is unused
			return [ { item: "Widgets", path: "/widgets" }, { item: this.title, path: "/widgets/" + this._id + "/edit"} ];
		} else if ( routeName == "View Widget" ) {
			// Applies to: view widget page
			return [ { item: "Widgets", path: "/widgets" }, { item: this.title, path: "/widgets/" + this._id} ];
		} else if ( routeName == "Edit App" ) {
			// Applies to: edit app page
			return [ { item: "Apps", path: "/apps" }, { item: this.title, path: "/apps/" + this._id} ];
		} else if ( routeName == "Edit Theme" ) {
			// Applies to: edit theme page
			return [ { item: "Themes", path: "/themes" }, { item: this.title, path: "/themes/" + this._id } ];
		} else {
			//console.log("from breadcrumb, should not run");
			return [{ item: "None", path: "/none" }, { item: "none", path: "/none/" + 2324 }]
		}
	}
});