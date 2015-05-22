Template.AppBodyLayout.helpers({
	currentAppName: function() {
		return Session.get("currentApp").title;
	}
});