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
	labelClass: function() {
  if (this.status.idle)
    return "label-warning"
  else if (this.status.online)
    return "label-success"
  else
    return "label-default"
	}
});



