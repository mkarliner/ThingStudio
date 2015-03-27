Template.onlineUsers.usersOnline = function() {
  return Meteor.users.find({ "status.online": true })
};