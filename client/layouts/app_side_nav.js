Template.AppSideNav.onRendered(function() {
    $('select').material_select();
    $('.collapsible').collapsible();
});

Template.AppSideNav.events({
	'click .collapsible': function(e, tmpl) {

	}
});

Template.AppSideNav.helpers({
	username: function() {
		return Meteor.user().username;
	}
});