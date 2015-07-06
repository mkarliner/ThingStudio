Template.LatestScreenUpdates.helpers({
	recentUpdates: function(){
		date = new Date();
		date.setDate(date.getDate() - 1); //Yesterday
		return Screens.find({updatedAt: {$gte: date }});
	}
	
});


Template.SysLogs.helpers({
	syslogs: function(){
		return SysLogs.find({}, {sort: {date: -1}});
	},
	viewlink: function() {
		console.log("VL: ", this);
		switch(this.event) {
		case "ScreenUpdate":
			return "#";
		}
	}
	
});

Template.SysLogs.events({
	'click .select-app': function(ev) {
		console.log("APPCL ", ev, this)
		ev.preventDefault();
		Meteor.subscribe("apps", this.appId);
		Session.set("guestAppId", this.appId)	
		changeActiveApp(this.appId);
	}
})