Template.onlineUsers.helpers ({
	activeUsers: function() {
  	  users =  Meteor.users.find({ "status.online": true })
		console.log("ONL ", users.fetch())
		return users;
	}
});



