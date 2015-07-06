Template.DashboardBody.onRendered(function() {
	$('ul.tabs').tabs();
	$('.tooltipped').tooltip({delay: 50});
});

Template.DashboardBody.events({
	'click .select-app': function(ev) {
		ev.preventDefault();
		changeActiveApp(this._id);
	}
});


Template.DashboardBody.helpers({
	appslist: function() {
		return Apps.find().fetch();
	},
	current_app: function(){
		if(this._id == Session.get("currentAppId")) {
			return true;
		} else {
			return false;
		}
	},
	connection_title: function() {
		connection = Connections.find({_id: this.connection}).fetch()
		return connection[0].title
	},
	home_screen: function() {
		home_screen = Screens.find({_id: this.home_page}).fetch()
		return home_screen[0].title
	}
});