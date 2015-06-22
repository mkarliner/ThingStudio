 
Tracker.autorun(function(){
	try {
		if(!UserStatus.isMonitoring()) {
			 UserStatus.startMonitor({threshold: 20000, interval: 10000});
		}		
	}
	catch(e) {
		console.log("Userstatus start monitor failed ", e);
	}
})
 	




Template.onlineUsers.helpers ({
	activeUsers: function() {
  	  users =  Meteor.users.find({ "status.online": true })
		// console.log("ONL ", users.fetch())
		return users;
	}
});

Template.onlineAdmins.helpers ({
	activeAdmin: function() {
		// Only needs one admin to be available.
		user =  Meteor.users.findOne({ roles: "admin", "status.online": true });
		console.log("AU  ", user)
		if(user) {
			return user.username;
		} else {
			return "offline"
		}

	}
});

Template.userPill.helpers({
	idlestatus: function(){
		console.log("IDL", this.status);
	},
	labelClass: function() {
  if (this.status.idle)
    return "status-idle"
  else
    return "status-active"
	}
});



