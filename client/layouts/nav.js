Template.registerHelper("isInRole",
	 function(role) {
		u = Meteor.user();
		if(u) {
			roles = u.roles;
			if( roles && roles.indexOf(role) >= 0) {
				return true;
			} else {
				false;
			}
		} else {
			return false;
		}
	});
	

Template.TopNav.helpers({
	currentApp: function() {
		app = Session.get("currentApp");
		return app ? app.title : "not set";
	}
})