Template.TopNav.helpers({
	isInRole: function(role) {
		roles = Meteor.user().roles;
		console.log("ROLEs: ",roles, role);
		if( roles && roles.indexOf(role) >= 0) {
			return true;
		} else {
			false;
		}
	}
});