Template.AppSideNav.onRendered(function() {
    $('.collapsible').collapsible();
});

Template.AppSideNav.events({
	// 'click .collapsible': function(e, tmpl) {
	// 	var collapsibleIcon= tmpl.find('i.mdi-hardware-keyboard-arrow-down');
	// 	var angle = $(collapsibleIcon).data('angle');
	// 	$(collapsibleIcon).data('angle', angle + 180);
	// 	$(collapsibleIcon).css({'transform': 'rotate(' + angle + ')'});
	// }
});

Template.AppSideNav.helpers({
	myName: function() {
		u = Meteor.user();
		if(!u) {
			return("No name");
		}
		if(!u.profile || !u.profile.firstName) {
			return("No name set");
		}
		var firstName = u.profile.firstName || '';
		var lastName = u.profile.lastName || '';
		if ( firstName != '' && lastName != '' ) {
			return firstName + " " + lastName;
		} else if ( firstName ) {
			return firstName;
		} else {
			return u.username;
		}
	},
	currentAppId: function(){
		return Session.get("currentAppId");
	},
	// numChats: function(){
	// 	return Chats.find().count();
  //
	// },
	// newChats: function(){
	// 	//console.log("NC: ", Session.get("newChats"))
	// 	if ( Session.get("newChats") == true ) {
	// 		return true;
	// 	} else {
	// 		return false;
	// 	}
	// },
  appURL: function(){
    return '/app/' + Session.get("currentAppId");
	}
});
