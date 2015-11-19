Template.LatestScreenUpdates.helpers({
	recentUpdates: function(){
		date = new Date();
		date.setDate(date.getDate() - 1); //Yesterday
		return Screens.find({updatedAt: {$gte: date }});
	}
	
});

Template.SysadminHeader.helpers({
	activeUsers: function(){
		logs = SysLogs.find({}).fetch();
		activeUsers = _.uniq(logs, false, function(d){ return d.userName})
		return _.pluck(activeUsers, "userName").length-1;
	},
	newUsers: function(){
		return SysLogs.find({event: "New User"}).count();
	}
});


Template.SysLogs.events({
	"change #showTemplateViews": function(event) {
		Session.set("showTemplateViews", event.target.checked);
	}
})

Template.SysadminBody.helpers({
	syslogs: function(){
		tmpl = Template.instance();
		types = ["ScreenUpdate", "New User", "UserAction", "AppRemove"];
		if(Session.get("showTemplateViews")) {
			types.push("TemplateView");
		}		
		return SysLogs.find({event: {$in: types}}, {sort: {date: -1}}).fetch();
	},
});


Template.SysLogs.helpers({
	viewlink: function() {
		console.log("VL: ", this);
		switch(this.event) {
		case "ScreenUpdate":
			return "#";
		}
	},
	date: function(){
		return moment(this.date).fromNow();
	},
    foo: function(){
        console.log("FOO", this)
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