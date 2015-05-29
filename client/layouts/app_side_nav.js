Template.AppSideNav.onRendered(function() {
    $('.collapsible').collapsible();
});

Template.AppSideNavSelect.onRendered(function() {
	$('select').material_select();
});

Template.AppSideNav.events({
	'click .collapsible': function(e, tmpl) {
		console.log("open has been clicked");
		var collapsibleIcon= tmpl.find('i.mdi-hardware-keyboard-arrow-down');
		var angle = $(collapsibleIcon).data('angle');
		$(collapsibleIcon).data('angle', angle + 180);
		console.log(angle);
		$(collapsibleIcon).css({'transform': 'rotate(' + angle + ')'});
	}
	// 'click .collapsible li.active': function(e, tmpl) {
	// 	console.log("close has been clicked");
	// 	var collapsibleIcon= tmpl.find('i.mdi-hardware-keyboard-arrow-down');
	// 	$(collapsibleIcon).css({'transform': 'rotate(360deg)'});
	// },
});

Template.AppSideNavSelect.events({
	'change .sidenav-app-selector select': function(e, tmpl) {
		var myThing = tmpl.find(":selected");
		// console.log('this was selected: ', myThing)
		var myThingVal = $(myThing).attr("value");
		// console.log('here is myThingVal: ', myThingVal)
		// var appHere = Apps.findOne({_id: myThingVal});
		// console.log('here is appHere: ', appHere)
		UnsubscribeAll();
		DisconnectMQTT();
		// console.log('before setPersistent, currentAppId is: ', Session.get("currentAppId"))
		Session.setPersistent("currentAppId", myThingVal);
		// console.log('after setPersistent, currentAppId is: ', Session.get("currentAppId"));
		ResetMessages();
		$('select').material_select('destroy');
		$('.sidenav-app-selector').remove();
		setTimeout(function() {
			Blaze.render(Template.AppSideNavSelect, $('.select-parent')[0]);
		}, 100);
		
	}
});

Template.AppSideNav.helpers({
	myName: function() {
		var firstName = Meteor.user().profile.firstName || '';
		var lastName = Meteor.user().profile.lastName || '';
		if ( firstName != '' && lastName != '' ) {
			return firstName + " " + lastName;
		} else if ( firstName ) {
			return firstName;
		} else {
			return Meteor.user().username;
		}
	}
});

Template.AppSideNavSelect.helpers({
	appsList: function() {
		var currId = Session.get("currentAppId");
		return Apps.find({owner: Meteor.userId(), _id: {$nin: [currId]}});
	},
	current_app_name: function(){
		if (  Session.get("currentApp") ) {
			console.log("current_app_name, ", Session.get("currentApp"))
			return Session.get("currentApp");
		} else {
			return false;
		}
	}
});