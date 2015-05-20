Template.AppBody.helpers({
	currentAppName: function() {
		return Session.get("currentApp").title;
	}
});