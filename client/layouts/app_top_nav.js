Template.AppTopNav.onRendered(function() {
    $(".dropdown-button").dropdown();
});

Template.BreadcrumbsContent.helpers({
	route_base: function() {
		var routeName = Router.current().route.getName();
		var routePath = Router.current().route.path();
		if ( routeName == "Connections" || routeName =="Data Feeds" || routeName =="Screens" || routeName == "Themes") {
			console.log("triggering CDST")
			return Session.get("appTreeList");
		} else {
			var routeObj = {_id: routePath, title: routeName};
			console.log(routeObj);
			return [routeObj];
		}
	},
	breadcrumb: function() {
		var routeCrumb = Router.current().route.getName();
		if ( routeCrumb == "Docs") {
			return this.title;
		} else if ( routeCrumb == "Connections" || routeCrumb == "Data Feeds" || routeCrumb == "Screens" || routeCrumb == "Themes") {
			return routeCrumb;
		} else {
			return false;
		}
	}
});