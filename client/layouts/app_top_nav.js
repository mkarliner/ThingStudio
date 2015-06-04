Template.AppTopNav.onRendered(function() {
    $(".dropdown-button").dropdown();
    	$('.tnconn.tooltipped').tooltip({delay: 400});
});

Template.AppTopNav.helpers({
	currentConnectionName: function() {
		app = getCurrentConnection;
		if (app) {
			return getCurrentConnection().title;
		} else {
			return 'no app';
		}
	}
});

Template.BreadcrumbsContent.helpers({
	route_base: function() {
		var routeName = Router.current().route.getName();
		var routePath = Router.current().route.path();
		if ( routeName == "Connections" || routeName =="Data Feeds" || routeName =="Templates" || routeName == "Themes" || routeName == "View Feed" ) {
			return Session.get("appTreeList");
		} else if ( routeName == "Dashboard" ){
			return false;
		} else {
			var routeObj = {_id: routePath, title: routeName};
			return [routeObj];
		}
	},
	breadcrumb: function() {
		var routeCrumb = Router.current().route.getName();
		if ( routeCrumb == "Docs") {
			return this.title;
		} else if ( routeCrumb == "Connections" || routeCrumb == "Data Feeds" || routeCrumb == "Templates" || routeCrumb == "Themes" ) {
			return routeCrumb;
		} else if ( routeCrumb == "View Feed" ) {
			return "Data Feeds / " + routeCrumb;
		} else {
			return false;
		}
	}
});