Template.DashboardBody.helpers({
	appslist: function() {
		return Apps.find().fetch();
	}
});