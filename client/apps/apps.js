Template.Apps.helpers({
	appslist: function(){
		return Apps.find({})
	},
	status: function(){
		status = this.owner == Meteor.userId() ? "Owner" : "" 
		status += this.access;
	}
});

Template.Apps.events({
	'click #select-app': function(ev) {
		ev.preventDefault();
		console.log(this);
		UnsubscribeAll();
		DisconnectMQTT();
		Session.set("currentApp",this);
		ResetMessages();
	}
})