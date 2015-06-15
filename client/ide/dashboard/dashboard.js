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
});