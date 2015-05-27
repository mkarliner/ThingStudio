Template.AppTopNav.onRendered(function() {
    $(".dropdown-button").dropdown();
});

Template.BreadcrumbsContent.helpers({
	route_base: function() {
		var routeName = Router.current().route.getName();
		var routePath = Router.current().route.path();
		if ( routeName == "Connections" || routeName =="DataFeeds" || routeName =="Templates" || routeName == "Themes" || routeName == "ViewFeed" ) {
			return Session.get("appTreeList");
		} else {
			var routeObj = {_id: routePath, title: routeName};
			return [routeObj];
		}
	},
	breadcrumb: function() {
		var routeCrumb = Router.current().route.getName();
		if ( routeCrumb == "Docs") {
			return this.title;
		} else if ( routeCrumb == "Connections" || routeCrumb == "DataFeeds" || routeCrumb == "Templates" || routeCrumb == "Themes" ) {
			return routeCrumb;
		} else if ( routeCrumb == "View Feed" ) {
			return "Data Feeds / " + routeCrumb;
		} else {
			return false;
		}
	}
});