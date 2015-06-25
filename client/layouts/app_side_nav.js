Template.AppSideNav.onRendered(function() {
    $('.collapsible').collapsible();
});

// Template.AppSideNavSelect.onRendered(function() {
// 	$('.side-nav select').material_select();
// });

Template.AppSideNav.events({
	'click .collapsible': function(e, tmpl) {
		var collapsibleIcon= tmpl.find('i.mdi-hardware-keyboard-arrow-down');
		var angle = $(collapsibleIcon).data('angle');
		$(collapsibleIcon).data('angle', angle + 180);
		$(collapsibleIcon).css({'transform': 'rotate(' + angle + ')'});
	}
	// 'click .collapsible li.active': function(e, tmpl) {
	// 	console.log("close has been clicked");
	// 	var collapsibleIcon= tmpl.find('i.mdi-hardware-keyboard-arrow-down');
	// 	$(collapsibleIcon).css({'transform': 'rotate(360deg)'});
	// },
});

// Template.AppSideNavSelect.events({
// 	'change .sidenav-app-selector select': function(e, tmpl) {
// 		var myThing = tmpl.find(":selected");
// 		var myThingVal = $(myThing).attr("value");
// 		UnsubscribeAll();
// 		DisconnectMQTT();
// 		Session.setPersistent("currentAppId", myThingVal);
// 		ResetMessages();
// 		Tracker.autorun(function() {
// 			Session.get("currentApp")
// 			redrawSideNavSelect();
// 		})
// 	}
// });

Template.AppSideNav.helpers({
	myName: function() {
		u = Meteor.user();
		if(!u) {
			return("No name");
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
	numChats: function(){
		Session.set("newChats", true);
		Meteor.setTimeout(function(){
			Session.set("newChats", false);
		}, 1200 * 1000)
		return Chats.find().count();
		
	},
	newChats: function(){
		if ( Session.get("newChats") ) {
			return true;
		} else {
			return false;
		}
	}
});

Template.AppSideNav.helpers({
	// appsList: function() {
	// 	var currId = Session.get("currentAppId");
	// 	return Apps.find({owner: Meteor.userId(), _id: {$nin: [currId]}});
	// },
	// current_app_name: function(){
	// 	if (  Session.get("currentApp") ) {
	// 		return Session.get("currentApp");
	// 	} else {
	// 		return false;
	// 	}
	// }
});