Template.AppTopNav.onRendered(function() {
    $(".dropdown-button").dropdown();
});

Template.BreadcrumbsContent.helpers({
	route_base: function() {
		var route = Router.current().route.getName();
		if ( route == "Connections" || route =="Data Feeds" || route =="Screens" || route == "Themes") {
			return Session.get("appTree");
		} else {
			return route;
		}
	},
	breadcrumb: function() {
		var routeCrumb = Router.current().route.getName();
		if ( routeCrumb == "Docs") {
			return this.title;
		} else if ( routeCrumb == "Connections" || routeCrumb == "Data Feeds" || routeCrumb == "Screens" || routeCrumb == "Themes") {
			return routeCrumb;
		}
	}
});